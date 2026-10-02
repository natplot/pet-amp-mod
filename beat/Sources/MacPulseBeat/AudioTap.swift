import Accelerate
import CoreAudio
import Foundation
import OSLog

/// Taps the Mac's audio output (Core Audio process tap, macOS 14.2+) and turns it
/// into 24 log-spaced spectrum bands, which the beat feed reads onsets from.
/// Only these band values leave this class; audio is never stored or sent.
/// The first start asks for the "System Audio Recording" permission.
final class AudioTap: @unchecked Sendable {
    static let bands = 24
    /// ~30 frames per second while something is playing; values 0...255.
    var onFrame: (([UInt8]) -> Void)?
    private(set) var running = false

    // Control (start/stop) and audio callbacks use separate queues: stopping the
    // device waits for the IO proc, which must not be queued behind us.
    private let queue = DispatchQueue(label: "dev.macpulse.beat.audio", qos: .userInitiated)
    private let ioQueue = DispatchQueue(label: "dev.macpulse.beat.audio.io", qos: .userInteractive)
    private let log = Logger(subsystem: "dev.macpulse.beat", category: "audio")
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?

    // analysis
    private let n = 2048
    private lazy var fft = vDSP.FFT(log2n: vDSP_Length(11), radix: .radix2, ofType: DSPSplitComplex.self)!
    private lazy var window = vDSP.window(ofType: Float.self, usingSequence: .hanningDenormalized, count: n, isHalfWindow: false)
    private var ring = [Float](repeating: 0, count: 2048)
    private var ringPos = 0
    private var sinceFrame = 0
    private var sampleRate: Double = 48000
    private var binRanges: [Range<Int>] = []
    private var peakDB: Float = -30
    private var loudFor: Double = 0, quietFor: Double = 10
    private var playing = false
    // The IO proc only runs while something is playing (the tap auto-starts).
    // If the output device is playing but we get no buffers, the aggregate died
    // quietly (e.g. after another app took the microphone): rebuild it.
    private var lastIO = DispatchTime.now()
    private var builtAt = DispatchTime.now()
    private var watchdog: DispatchSourceTimer?

    func start() {
        queue.async { [self] in
            guard !running else { return }
            do { try setUp(); running = true; log.notice("system audio tap started") }
            catch { log.error("audio tap failed: \(String(describing: error), privacy: .public)"); tearDown() }
            startWatchdog()
        }
    }

    func stop() {
        queue.sync { watchdog?.cancel(); watchdog = nil; tearDown(); running = false }
    }

    private func rebuild(reason: String) {
        log.notice("rebuilding audio tap: \(reason, privacy: .public)")
        tearDown()
        do { try setUp() } catch {
            log.error("audio tap rebuild failed: \(String(describing: error), privacy: .public)"); tearDown()
        }
        lastIO = .now()
    }

    private func startWatchdog() {
        guard watchdog == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 3, repeating: 2, leeway: .milliseconds(500))
        t.setEventHandler { [weak self] in
            guard let self, self.running else { return }
            guard self.outputIsPlaying() else { return }          // silence: no buffers is normal
            let now = DispatchTime.now().uptimeNanoseconds
            let since = max(self.lastIO.uptimeNanoseconds, self.builtAt.uptimeNanoseconds)
            let idle = Double(now - since) / 1e9
            if idle > 3 { self.rebuild(reason: "output playing but no buffers for \(Int(idle)) s") }
        }
        t.resume()
        watchdog = t
    }

    // MARK: Core Audio

    private struct Failure: Error { let step: String; let status: OSStatus }
    private func check(_ status: OSStatus, _ step: String) throws {
        if status != noErr { throw Failure(step: step, status: status) }
    }

    private func setUp() throws {
        let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        desc.uuid = UUID()
        desc.name = "Mac Pulse Beat spectrum"
        desc.isPrivate = true
        desc.muteBehavior = .unmuted
        try check(AudioHardwareCreateProcessTap(desc, &tapID), "create tap")

        var format = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var addr = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal,
                                              mElement: kAudioObjectPropertyElementMain)
        try check(AudioObjectGetPropertyData(tapID, &addr, 0, nil, &size, &format), "tap format")
        sampleRate = format.mSampleRate > 0 ? format.mSampleRate : 48000
        let channels = Int(max(1, format.mChannelsPerFrame))
        let interleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        makeBins()

        let outputUID = try defaultOutputUID()
        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Mac Pulse Beat tap",
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true,
                                               kAudioSubTapUIDKey: desc.uuid.uuidString]],
        ]
        try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID), "create aggregate")
        try check(AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, ioQueue) { [weak self] _, input, _, _, _ in
            self?.consume(input, channels: channels, interleaved: interleaved)
        }, "create IO proc")
        try check(AudioDeviceStart(aggregateID, procID), "start device")
        ioCount = 0
        builtAt = .now()
        log.notice("tap \(self.tapID) agg \(self.aggregateID) \(Int(self.sampleRate)) Hz \(channels) ch interleaved=\(interleaved) output=\(outputUID, privacy: .public)")
        watchOutputDevice()
    }

    private func defaultOutputUID() throws -> String {
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        try check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &device), "output device")
        var uid: Unmanaged<CFString>?
        size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        addr.mSelector = kAudioDevicePropertyDeviceUID
        try check(AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &uid), "output device UID")
        return (uid?.takeRetainedValue() as String?) ?? ""
    }

    /// Whether any process is currently running the default output device.
    private func outputIsPlaying() -> Bool {
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &device) == noErr else { return false }
        var running: UInt32 = 0
        size = UInt32(MemoryLayout<UInt32>.size)
        addr.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere
        guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, &running) == noErr else { return false }
        return running != 0
    }

    private var watchingOutput = false
    /// The aggregate is clocked by the output device; rebuild it when that changes.
    private func watchOutputDevice() {
        guard !watchingOutput else { return }
        watchingOutput = true
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, queue) { [weak self] _, _ in
            guard let self, self.running else { return }
            self.rebuild(reason: "output device changed")
        }
    }

    private func tearDown() {
        if aggregateID != kAudioObjectUnknown {
            if let procID {
                AudioDeviceStop(aggregateID, procID)
                AudioDeviceDestroyIOProcID(aggregateID, procID)
            }
            AudioHardwareDestroyAggregateDevice(aggregateID)
        }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        procID = nil
        aggregateID = AudioObjectID(kAudioObjectUnknown)
        tapID = AudioObjectID(kAudioObjectUnknown)
        if playing { playing = false }
    }

    // MARK: analysis

    /// 24 log-spaced bands from 40 Hz to 16 kHz over the FFT bins.
    private func makeBins() {
        let hz = sampleRate / Double(n)
        binRanges = (0..<Self.bands).map { b in
            let lo = 40 * pow(16000.0 / 40, Double(b) / Double(Self.bands))
            let hi = 40 * pow(16000.0 / 40, Double(b + 1) / Double(Self.bands))
            let l = max(1, Int(lo / hz))
            return l..<max(l + 1, Int(hi / hz))
        }
    }

    private var ioCount = 0
    private func consume(_ input: UnsafePointer<AudioBufferList>, channels: Int, interleaved: Bool) {
        lastIO = .now()
        ioCount += 1
        if ioCount == 1 { log.notice("first audio callback") }
        let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
        guard let first = list.first, let data = first.mData else { return }
        let frames: Int
        if interleaved {
            frames = Int(first.mDataByteSize) / (MemoryLayout<Float>.size * channels)
            let p = data.assumingMemoryBound(to: Float.self)
            for i in 0..<frames {
                var s: Float = 0
                for c in 0..<channels { s += p[i * channels + c] }
                push(s / Float(channels))
            }
        } else {
            frames = Int(first.mDataByteSize) / MemoryLayout<Float>.size
            for i in 0..<frames {
                var s: Float = 0
                for buf in list { if let d = buf.mData { s += d.assumingMemoryBound(to: Float.self)[i] } }
                push(s / Float(list.count))
            }
        }
        sinceFrame += frames
        let hop = Int(sampleRate / 30)
        if sinceFrame >= hop {
            analyse(seconds: Double(sinceFrame) / sampleRate)
            sinceFrame = 0
        }
    }

    @inline(__always) private func push(_ s: Float) {
        ring[ringPos] = s
        ringPos = (ringPos + 1) & (n - 1)
    }

    private func analyse(seconds: Double) {
        // latest n samples in time order, windowed
        let ordered = Array(ring[ringPos...] + ring[..<ringPos])
        let rms = vDSP.rootMeanSquare(ordered)
        let windowed = vDSP.multiply(ordered, window)

        var real = [Float](repeating: 0, count: n / 2), imag = [Float](repeating: 0, count: n / 2)
        var power = [Float](repeating: 0, count: n / 2)
        real.withUnsafeMutableBufferPointer { rp in
            imag.withUnsafeMutableBufferPointer { ip in
                var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                windowed.withUnsafeBufferPointer { w in
                    w.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: n / 2) {
                        vDSP_ctoz($0, 2, &split, 1, vDSP_Length(n / 2))
                    }
                }
                fft.forward(input: split, output: &split)
                vDSP.squareMagnitudes(split, result: &power)
            }
        }

        // playing = loud enough for a moment; stopped after 2 s of near-silence
        let dbfs = 20 * log10(max(rms, 1e-9))
        if dbfs > -55 { loudFor += seconds; quietFor = 0 } else { quietFor += seconds; loudFor = 0 }
        if !playing && loudFor > 0.3 { playing = true }
        if playing && quietFor > 2 { playing = false }
        guard playing else { return }

        // band levels in dB, normalised against a slowly decaying peak (auto gain)
        var db = [Float](repeating: -120, count: Self.bands)
        for (b, r) in binRanges.enumerated() where r.upperBound <= power.count {
            let mean = power[r].reduce(0, +) / Float(r.count)
            db[b] = 10 * log10(mean + 1e-12)
        }
        let frameMax = db.max() ?? -120
        peakDB = max(frameMax, peakDB - 0.25)
        let range: Float = 42
        let out = db.map { v -> UInt8 in
            let x = max(0, min(1, (v - (peakDB - range)) / range))
            return UInt8(pow(x, 1.6) * 255)       // gamma: keeps quiet bands low, peaks punchy
        }
        onFrame?(out)
    }
}
