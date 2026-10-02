import Testing
@testable import BeatCore

struct BeatEstimatorTests {
    /// Onsets of a steady pulse as the audio tap reports them: one analysis
    /// frame every 2048 samples at 48 kHz, each onset landing on the frame after
    /// it, over a floor of noise, with every fourth beat missing.
    private func pulse(bpm: Double, seconds: Double, firstBeat: Double) -> (estimator: BeatEstimator, now: Double) {
        var estimator = BeatEstimator()
        var noise = SystemRandomNumberGenerator()
        let frame = 2048.0 / 48000, period = 60 / bpm
        var time = 0.0, beat = firstBeat, count = 0
        while time < seconds {
            var flux = Double.random(in: 0...0.08, using: &noise)
            if beat <= time {
                if count % 4 != 3 { flux += 1 }
                beat += period; count += 1
            }
            estimator.add(time: time, flux: flux)
            time += frame
        }
        return (estimator, time)
    }

    @Test(arguments: [128.0, 96, 110, 140])
    func findsTempoAndPhaseOfASteadyPulse(bpm: Double) throws {
        let period = 60 / bpm, firstBeat = 0.137
        let (estimator, now) = pulse(bpm: bpm, seconds: 14, firstBeat: firstBeat)
        let found = try #require(estimator.estimate(now: now))
        #expect(abs(found.bpm - bpm) <= bpm * 0.015)
        // The reported beat should fall on the pulse's own grid, give or take
        // the frame an onset is delayed by.
        let phase = (found.beatAt - firstBeat).truncatingRemainder(dividingBy: period)
        let error = min(phase, period - phase)
        #expect(error < 0.06, "beat is \(error) s off the grid")
        #expect(found.beatAt <= now)
        #expect(found.beatAt > now - period * 1.05)
    }

    @Test func saysNothingWithoutHistoryOrOnsets() {
        var estimator = BeatEstimator()
        #expect(estimator.estimate(now: 0) == nil)
        for i in 0..<60 { estimator.add(time: Double(i) * 0.04, flux: 1) }
        #expect(estimator.estimate(now: 2.4) == nil, "two seconds is too little history")
        var silent = BeatEstimator()
        for i in 0..<400 { silent.add(time: Double(i) * 0.04, flux: 0) }
        #expect(silent.estimate(now: 16) == nil)
    }
}
