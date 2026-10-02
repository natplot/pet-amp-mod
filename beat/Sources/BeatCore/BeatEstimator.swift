import Foundation

/// A tempo and the time of a recent beat, on the clock the estimator was fed.
public struct BeatEstimate: Equatable, Sendable {
    public let bpm: Double
    /// When a beat fell, in seconds on the input clock; the last one at or before `now`.
    public let beatAt: Double
    /// Autocorrelation at the chosen period over the signal's energy, 0...1.
    public let confidence: Double
}

/// Estimates tempo and beat phase from an onset-strength signal: how much the
/// spectrum grew from one analysis frame to the next. Frames may arrive at an
/// uneven rate; they are binned onto a uniform grid before analysis.
public struct BeatEstimator: Sendable {
    private let rate: Double
    private let window: Double
    private var frames: [(time: Double, flux: Double)] = []

    /// - Parameters:
    ///   - rate: grid resolution in Hz.
    ///   - window: seconds of history a tempo is read from.
    public init(rate: Double = 50, window: Double = 10) {
        self.rate = rate
        self.window = window
    }

    public mutating func add(time: Double, flux: Double) {
        frames.append((time, flux))
        let cutoff = time - window - 1
        if let first = frames.first, first.time < cutoff {
            frames.removeAll { $0.time < cutoff }
        }
    }

    public mutating func reset() { frames.removeAll() }

    public func estimate(now: Double) -> BeatEstimate? {
        let n = Int(window * rate)
        let start = now - window
        // Too little history says nothing about a period of up to a second.
        guard let first = frames.first, first.time <= now - window * 0.6 else { return nil }

        var onset = [Double](repeating: 0, count: n)
        for frame in frames {
            let i = Int((frame.time - start) * rate)
            if i >= 0 && i < n { onset[i] += frame.flux }
        }
        // A light blur joins an onset split across two bins.
        var env = onset
        for i in 1..<(n - 1) { env[i] = 0.25 * onset[i - 1] + 0.5 * onset[i] + 0.25 * onset[i + 1] }
        let mean = env.reduce(0, +) / Double(n)
        let centred = env.map { $0 - mean }
        let energy = centred.reduce(0) { $0 + $1 * $1 } / Double(n)
        guard energy > 1e-9 else { return nil }

        func correlation(_ lag: Int) -> Double {
            guard lag > 0 && lag < n else { return 0 }
            var sum = 0.0
            for i in 0..<(n - lag) { sum += centred[i] * centred[i + lag] }
            return sum / Double(n - lag)
        }

        // 60...200 BPM. A pulse correlates with itself at every multiple of its
        // period, so a prior centred on 120 BPM settles the choice between a
        // tempo and its half or double.
        let minLag = Int((rate * 60 / 200).rounded(.up)), maxLag = Int(rate * 60 / 60)
        func score(_ lag: Int) -> Double {
            let bpm = 60 * rate / Double(lag)
            let octaves = log2(bpm / 120)
            let prior = exp(-0.5 * (octaves / 0.9) * (octaves / 0.9))
            return correlation(lag) * prior
        }
        var best = minLag, bestScore = -Double.infinity
        for lag in minLag...maxLag {
            let s = score(lag)
            if s > bestScore { bestScore = s; best = lag }
        }
        guard bestScore > 0 else { return nil }

        // The true period rarely sits on a whole bin. Refine it between bins,
        // then against the peak several periods out, where one bin of error is
        // a smaller share of the lag.
        var period = Double(best) + Self.vertex(score(best - 1), bestScore, score(best + 1))
        for multiple in [2, 3, 4] where Double(multiple) * period < Double(n) / 2 {
            let near = Int((Double(multiple) * period).rounded())
            var peak = near, peakValue = -Double.infinity
            for lag in (near - 2)...(near + 2) {
                let c = correlation(lag)
                if c > peakValue { peakValue = c; peak = lag }
            }
            guard peakValue > 0 else { continue }
            period = (Double(peak) + Self.vertex(correlation(peak - 1), peakValue, correlation(peak + 1))) / Double(multiple)
        }

        // Phase: the offset whose comb of beats collects the most onset strength.
        func at(_ x: Double) -> Double {
            let i = Int(x.rounded(.down)), f = x - Double(i)
            guard i >= 0 && i + 1 < n else { return 0 }
            return env[i] * (1 - f) + env[i + 1] * f
        }
        func comb(_ offset: Double) -> Double {
            var sum = 0.0, x = offset
            while x < Double(n - 1) { sum += at(x); x += period }
            return sum
        }
        let steps = Int(period.rounded(.up))
        var bestOffset = 0, bestComb = -Double.infinity
        for o in 0..<steps {
            let c = comb(Double(o))
            if c > bestComb { bestComb = c; bestOffset = o }
        }
        let before = comb(Double((bestOffset - 1 + steps) % steps)), after = comb(Double((bestOffset + 1) % steps))
        let offset = Double(bestOffset) + Self.vertex(before, bestComb, after)
        let last = offset + ((Double(n - 1) - offset) / period).rounded(.down) * period

        return BeatEstimate(bpm: 60 * rate / period,
                            beatAt: start + (last + 0.5) / rate,
                            confidence: max(0, min(1, correlation(best) / energy)))
    }

    /// Where a parabola through three equally spaced samples peaks, as an
    /// offset from the middle one, within half a step.
    private static func vertex(_ a: Double, _ b: Double, _ c: Double) -> Double {
        let curve = a - 2 * b + c
        guard curve < 0 else { return 0 }
        return max(-0.5, min(0.5, 0.5 * (a - c) / curve))
    }
}
