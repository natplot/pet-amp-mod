# Mac Pulse Beat

A small menu-bar app that listens to what your Mac plays and publishes its tempo
and beat, so the Tape Club cat dances to the actual song.

It is the beat feed from Mac Pulse, a larger menu-bar utility, built on its
own for macOS 15 and later.

## How it works

- Tape Club touches `~/Library/Application Support/Mac Pulse/beat.want` every
  few seconds while music plays. While that file is fresh (12 s), the app taps
  the system audio output.
- It reduces the audio to 24 spectrum bands, measures how much the low end
  rises from frame to frame, and finds the tempo and the phase of the beat by
  autocorrelation over the last 10 seconds (60–200 BPM).
- Once a second it writes `beat.json` in the same folder:

  ```json
  { "bpm": 128.4, "beatAt": 1790977494923, "confidence": 0.53, "updatedAt": 1790977495390 }
  ```

- When nobody has asked for 12 seconds, it stops the tap and deletes
  `beat.json`.

Audio is never stored or sent anywhere. Only the tempo, a beat time and a
confidence leave the app.

The menu-bar icon shows ♩ while it waits and ♫ while it listens. Its menu has
Quit. It does not start at login.

## Requirements

- macOS 15 or later (the Core Audio process tap needs 14.2+).
- Swift 6 (Xcode or the Command Line Tools) to build.

## Install

```sh
bash scripts/install.sh
```

The script builds the app, signs it ad hoc, copies it to `~/Applications` and
starts it. The first time Tape Club asks for the beat, macOS asks for permission
to record system audio. A rebuild may ask again, since an ad hoc signature
changes with every build.

## Tests

With Xcode:

```sh
swift test
```

With only the Command Line Tools, point Swift at their Testing framework:

```sh
F=/Library/Developer/CommandLineTools/Library/Developer/Frameworks
swift test -Xswiftc -F -Xswiftc $F -Xlinker -F -Xlinker $F -Xlinker -rpath -Xlinker $F
```

## Layout

| Path | What |
| --- | --- |
| `Sources/BeatCore/BeatEstimator.swift` | Tempo and phase from an onset signal |
| `Sources/MacPulseBeat/AudioTap.swift` | The system audio tap and spectrum bands |
| `Sources/MacPulseBeat/BeatFeed.swift` | `beat.want` / `beat.json`, onsets from bands |
| `Sources/MacPulseBeat/main.swift` | The menu-bar app |
| `scripts/install.sh` | Build, bundle, install, start |
