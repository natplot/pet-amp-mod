import BeatCore
import Foundation
import OSLog

/// Publishes the tempo and beat of whatever the Mac is playing for other
/// programs on this Mac (the Tape Club mod in Claude), as a small JSON file.
/// Only a tempo, a beat time and a confidence leave this class; audio does not.
///
/// It runs on demand: a reader touches `beat.want` every few seconds, and the
/// audio tap is kept on only while that file is fresh.
final class BeatFeed: @unchecked Sendable {
    /// Called on the main queue when a reader appears or goes away.
    var onWantChange: (() -> Void)?
    private(set) var wanted = false

    private static let folder = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Mac Pulse", isDirectory: true)
    private let wantURL = BeatFeed.folder.appendingPathComponent("beat.want")
    private let beatURL = BeatFeed.folder.appendingPathComponent("beat.json")
    /// A reader that has not touched `beat.want` for this long has gone.
    private let wantTimeout: TimeInterval = 12
    /// An onset shows up late: half the FFT window, and on average half a frame.
    private let latency = 0.045

    private let queue = DispatchQueue(label: "dev.macpulse.beat", qos: .utility)
    private let log = Logger(subsystem: "dev.macpulse.beat", category: "beat")
    private var poll: DispatchSourceTimer?
    private var estimator = BeatEstimator()
    private var previous = [UInt8](repeating: 0, count: AudioTap.bands)
    private var lastFrame = 0.0, lastWrite = 0.0

    func start() {
        guard poll == nil else { return }
        try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 2, leeway: .milliseconds(500))
        timer.setEventHandler { [weak self] in self?.checkWant() }
        timer.resume()
        poll = timer
    }

    private func checkWant() {
        let touched = (try? FileManager.default.attributesOfItem(atPath: wantURL.path))?[.modificationDate] as? Date
        let now = touched.map { Date().timeIntervalSince($0) < wantTimeout } ?? false
        guard now != wanted else { return }
        wanted = now
        log.notice("beat reader \(now ? "appeared" : "left", privacy: .public)")
        if !now { queue.async { [self] in estimator.reset(); try? FileManager.default.removeItem(at: beatURL) } }
        onWantChange?()
    }

    /// One spectrum frame from the audio tap (any queue).
    func consume(_ bands: [UInt8]) {
        guard wanted else { return }
        let time = Date().timeIntervalSince1970
        queue.async { [self] in
            // A gap means the music stopped: what came before says nothing about now.
            if time - lastFrame > 1.5 { estimator.reset(); previous = bands }
            lastFrame = time
            // Onset strength: how much each band rose, the low end counting most.
            var flux = 0.0
            for (i, value) in bands.enumerated() where i < previous.count && value > previous[i] {
                flux += Double(value - previous[i]) / 255 * (i < 8 ? 1 : 0.3)
            }
            previous = bands
            estimator.add(time: time, flux: flux)
            guard time - lastWrite >= 1 else { return }
            lastWrite = time
            guard let beat = estimator.estimate(now: time) else { return }
            let json = String(format: "{\"bpm\":%.2f,\"beatAt\":%.0f,\"confidence\":%.3f,\"updatedAt\":%.0f}\n",
                              beat.bpm, (beat.beatAt - latency) * 1000, beat.confidence, time * 1000)
            try? json.write(to: beatURL, atomically: true, encoding: .utf8)
        }
    }
}
