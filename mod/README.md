# Tape Club

A cassette deck for Spotify and Apple Music inside Claude Code: a side pane and
a band above the prompt, with a pixel cat that taps its paws, wags its tail and
sways its head in time with the music.

An unofficial mod. Not made or endorsed by Anthropic, Apple or Spotify.

![The deck pane](docs/deck.png)

![The band above the prompt](docs/band.png)

## What it does

- **Deck pane** (`/tape`): the cassette with turning reels, the track and
  artist, a progress bar you can click to seek, and transport keys that sink
  when pressed.
- **Band above the prompt**: the same, in one row, plus a key that opens the
  deck.
- **The cat** moves on the beat: front paws in turn, tail across two beats, head
  across four.
- Off until you ask for it: nothing is drawn and no player is polled before
  `/tape`.

## Requirements

- macOS with the Spotify desktop app or the Music app. Both are driven through
  AppleScript, so the Spotify web player does not work. macOS asks once for
  permission to control each app. The deck follows Spotify when it has a track,
  and Music otherwise.
- Claude Code with function-hook plugins ("mods"). Tested with the desktop app's 2.1.281.
  That API is early access and changes between releases, so a newer build may
  need fixes here.
- The pictures need the desktop app. In a terminal the mod falls back to a line
  of text with buttons.

## Install

See the [main README](../README.md#install).

## Commands

| Command | Does |
| --- | --- |
| `/tape` | Turns the mod on in this session and opens the deck |
| `/tape off` | Turns it off: no band, no deck, no polling |
| `/tape close` | Closes the deck, keeps the band |
| `/tape keys` | Switches between the drawn keys and plain system buttons |
| `/tape vector` / `/tape raster` | Draws the cassette as plain shapes, or from the pictures |

## The beat

Without help the mod does not hear the music. It takes the tempo from the
track's BPM tag (Music only; Spotify has none), and with no tag assumes 100
BPM, so the cat keeps a steady pulse that is not the song's.

For the real beat, something has to listen to the audio and publish what it
hears. While the mod is on and music plays, the mod touches

    ~/Library/Application Support/Mac Pulse/beat.want

every few seconds, and reads, from the same folder, `beat.json`:

```json
{ "bpm": 128.4, "beatAt": 1790977494923, "confidence": 0.53, "updatedAt": 1790977495390 }
```

Times are Unix milliseconds; `beatAt` is the moment of a recent beat. A reading
older than six seconds or with confidence under 0.2 is ignored. Any program
that writes this file works; [Mac Pulse Beat](../beat) in this repository is
one.

## Limits

These come from what a mod can do on the desktop today, found by trial:

- A picture inside an SVG survives only when the SVG is shown as an image; the
  interactive frame strips it. One SVG may be at most 131072 characters, which
  is why the pictures are small.
- A mod cannot draw a clickable picture. The keys and the progress bar are
  pictures with blank system buttons laid over them, so the app's own hover and
  focus highlight shows on top, and seeking moves in steps of about 24 px.
- Sizes are worked out from the pane's column count with constants measured at
  the default text size (`CELL`, `BAND_COLUMN_PX` in `hooks/register.tsx`). At
  another text size the band may not fill its row and the hit areas may drift.
- For tracks streamed from the Apple Music catalogue, and for anything in
  Spotify, the player reports no playlist or queue, so the track list under the
  deck is empty.
- The main window, the sidebar and the prompt itself cannot be restyled.

## Changing the pictures

`hooks/assets.ts` is generated. Replace the files in `assets-src/` and run:

```sh
pip install pillow
python3 tools/gen_assets.py
```

The cat is `pixel-cat-faithful.svg`, cut into body, head, tail and two paws by
the boxes at the top of the script.

## Layout

| Path | What |
| --- | --- |
| `.claude-plugin/plugin.json` | The manifest |
| `hooks/register.tsx` | Hooks: polling the player, the commands, the pane and the band |
| `hooks/art.ts` | The drawings, as SVG strings |
| `hooks/assets.ts` | Generated pictures and cat paths |
| `types/index.d.ts` | The mod's state contract |
| `tools/gen_assets.py`, `assets-src/` | The generator and its sources |

Check a change with `claude plugin validate .`
