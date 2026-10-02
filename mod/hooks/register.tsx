import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TapeBeat, TapeNow, TapeTrack } from '../types'

import {
  BAND_HEIGHT,
  DECK_HEIGHT,
  DECK_WIDTH,
  KEYS_HEIGHT,
  KEY_SLOTS,
  bandBar,
  bandSlots,
  drawBand,
  drawDeck,
  drawKeys,
} from './art'

const PANE = 'tape-club'

// Drawn keys take their presses through blank Buttons laid over them. The
// numbers are measured off the desktop pane: a cell of the layout, the pitch
// of a row of Buttons, and a blank Button's padding and glyph width, in px.
const CELL = { width: 7.9, height: 18.25 }
const BLANK_BUTTON = { padding: 16, glyph: 8.4 }
const BAND_COLUMN_PX = 7.88
const BLANK = '\u2800'
const POLL_MS = 2500
// A seek or a stall shows as the player's position leaving where it should be.
const DRIFT_SECONDS = 3

// Off until the person runs /tape in the session: nothing is drawn and Music
// is not asked.
const isOn = atom({ plugin: 'tape-club', key: 'isOn' } as const, false)
const now = atom({ plugin: 'tape-club', key: 'now' } as const, null)
const art = atom({ plugin: 'tape-club', key: 'art' } as const, 'raster')
const hasPet = atom({ plugin: 'tape-club', key: 'hasPet' } as const, true)
const beat = atom({ plugin: 'tape-club', key: 'beat' } as const, null)
const pressed = atom({ plugin: 'tape-club', key: 'pressed' } as const, null)
const hasKeys = atom({ plugin: 'tape-club', key: 'hasKeys' } as const, true)

// The player the deck drives: Spotify when it has a track, else Music. Each is
// asked in its own osascript run, since a script naming an app that is not
// installed does not compile.
type Player = 'Spotify' | 'Music'
let player: Player = 'Spotify'

// Spotify reports duration in ms, carries no tempo and shows no playlist.
const SPOTIFY_SNAPSHOT = `
if application "Spotify" is not running then return "off"
tell application "Spotify"
  set ps to player state as text
  if ps is "stopped" then return "stopped"
  set t to current track
  return ps & linefeed & (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & ((duration of t) / 1000) & linefeed & (player position) & linefeed & 0
end tell`

// Asks Music only while it runs, so a poll never launches the app. One field
// per line, then the current track's neighbours as index, name and time.
const MUSIC_SNAPSHOT = `
if application "Music" is not running then return "off"
tell application "Music"
  set ps to player state as text
  if ps is "stopped" then return "stopped"
  set t to current track
  set res to ps & linefeed & (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & (duration of t) & linefeed & (player position) & linefeed & (bpm of t)
  try
    set pl to current playlist
    set i to index of t
    set n to count of tracks of pl
    set res to res & linefeed & (name of pl) & linefeed & i
    set lo to i - 1
    if lo < 1 then set lo to 1
    set hi to lo + 6
    if hi > n then set hi to n
    repeat with k from lo to hi
      set tk to track k of pl
      set res to res & linefeed & k & tab & (name of tk) & tab & (time of tk)
    end repeat
  end try
  return res
end tell`

// AppleScript writes decimals in the system locale: "214,5" on a Russian Mac.
const number = (text: string | undefined) => Number((text ?? '').replace(',', '.')) || 0

function parse(stdout: string, at: number): TapeNow | null {
  const lines = stdout.replace(/\n$/, '').split('\n')
  const state = lines[0]

  if (state !== 'playing' && state !== 'paused') {
    return null
  }

  const tracks: TapeTrack[] = lines.slice(9).flatMap(line => {
    const [index, name, time] = line.split('\t')

    return name === undefined ? [] : [{ index: number(index), name, time: time ?? '' }]
  })

  return {
    isPlaying: state === 'playing',
    name: lines[1] ?? '',
    artist: lines[2] ?? '',
    album: lines[3] ?? '',
    duration: number(lines[4]),
    position: number(lines[5]),
    at,
    bpm: number(lines[6]),
    playlist: lines[7] ?? '',
    index: number(lines[8]),
    tracks,
  }
}

const positionAt = (tape: TapeNow, at: number) =>
  tape.isPlaying ? tape.position + (at - tape.at) / 1000 : tape.position

function isSame(a: TapeNow | null, b: TapeNow | null) {
  if (a === null || b === null) {
    return a === b
  }

  return (
    a.isPlaying === b.isPlaying &&
    a.name === b.name &&
    a.artist === b.artist &&
    a.index === b.index &&
    a.playlist === b.playlist &&
    a.tracks.length === b.tracks.length &&
    Math.abs(positionAt(a, b.at) - b.position) < DRIFT_SECONDS
  )
}

let isBusy = false

// Mac Pulse publishes the beat it hears while a reader keeps `beat.want` fresh.
const BEAT_FOLDER = 'Library/Application Support/Mac Pulse'
// Older than this, or weaker, and the feed is not describing what plays now.
const BEAT_STALE_MS = 6000
const BEAT_MIN_CONFIDENCE = 0.2
// A new reading replaces the drawn one once it disagrees by this much; a
// redraw re-times every loop, so smaller wobble is left alone.
const BEAT_TEMPO_DRIFT = 0.015
const BEAT_PHASE_DRIFT_MS = 60

async function hearBeat(
  $: EngineInterface,
  isListening: boolean,
): Promise<{ bpm: number; beatAt: number } | null> {
  const home = await $.env.get('HOME')

  if (!isListening || home === undefined) {
    return null
  }

  const folder = `${home}/${BEAT_FOLDER}`
  try {
    await $.fs.write(`${folder}/beat.want`, '')
    const heard = JSON.parse(await $.fs.read(`${folder}/beat.json`)) as Record<string, unknown>
    const { bpm, beatAt, confidence, updatedAt } = heard

    if (
      typeof bpm !== 'number' ||
      typeof beatAt !== 'number' ||
      typeof confidence !== 'number' ||
      typeof updatedAt !== 'number' ||
      confidence < BEAT_MIN_CONFIDENCE ||
      (await $.clock.now()) - updatedAt > BEAT_STALE_MS
    ) {
      return null
    }

    return { bpm, beatAt }
  } catch {
    // Mac Pulse is not running, or has not heard enough yet.
    return null
  }
}

// Which beat opens the bar is ours to choose, but once chosen it must hold: the
// new reading's bar starts on the beat the drawn one would have counted as one.
function barOf(drawn: TapeBeat | null, heard: { bpm: number; beatAt: number }) {
  if (drawn === null) {
    return heard.beatAt
  }

  const beatsIn = Math.round((heard.beatAt - drawn.barAt) / (60000 / drawn.bpm))

  return heard.beatAt - (((beatsIn % 4) + 4) % 4) * (60000 / heard.bpm)
}

function isSameBeat(a: TapeBeat | null, b: { bpm: number; beatAt: number } | null) {
  if (a === null || b === null) {
    return a === b
  }

  const period = 60000 / b.bpm
  const apart = (((b.beatAt - a.beatAt) % period) + period) % period

  return (
    Math.abs(a.bpm - b.bpm) / b.bpm < BEAT_TEMPO_DRIFT &&
    Math.min(apart, period - apart) < BEAT_PHASE_DRIFT_MS
  )
}
// Writes the state only when what is drawn would change: each write redraws
// the deck, and a redraw restarts the reels and the tail.
async function refresh($: EngineInterface) {
  if (isBusy || !(await read($, isOn))) {
    return
  }

  isBusy = true
  try {
    let next: TapeNow | null = null
    for (const [app, script] of [['Spotify', SPOTIFY_SNAPSHOT], ['Music', MUSIC_SNAPSHOT]] as const) {
      const ran = await $.process.run(['osascript', '-e', script], { timeoutMs: 5000 })
      next = ran.exitCode === 0 ? parse(ran.stdout, await $.clock.now()) : null

      if (next !== null) {
        player = app
        break
      }
    }

    if (!isSame(await read($, now), next)) {
      await update($, now, () => next)
    }

    // Listen while something plays: the band's cat dances too, deck open or not.
    const heard = await hearBeat($, next?.isPlaying === true)

    const drawn = await read($, beat)

    if (!isSameBeat(drawn, heard)) {
      await update($, beat, () => (heard ? { ...heard, barAt: barOf(drawn, heard) } : null))
    }
  } finally {
    isBusy = false
  }
}

async function tell($: EngineInterface, command: string) {
  await $.process.run(['osascript', '-e', `tell application "${player}" to ${command}`], {
    timeoutMs: 5000,
  })
  await refresh($)
}

// A drawn key: mark the press first, so the key sinks before Music answers.
async function pressKey($: EngineInterface, slot: number, command: string) {
  const at = await $.clock.now()
  await update($, pressed, () => ({ slot, at }))

  if (command === 'deck') {
    await $.ui.open({ id: PANE, title: 'Tape Club', columns: 46 })
  } else {
    await tell($, command)
  }
}

// A press on the progress bar: jump to that share of the track.
async function seekTo($: EngineInterface, share: number) {
  const tape = await read($, now)

  if (tape !== null && tape.duration > 0) {
    await tell($, `set player position to ${Math.round(tape.duration * share)}`)
  }
}

// The bar takes presses through a row of blank Buttons laid along it, each
// three cells wide: where each one starts, in px from the bar's left end.
const SEEK_STEP_CELLS = 3
function seekStops(barPx: number) {
  const step = SEEK_STEP_CELLS * CELL.width
  const count = Math.max(1, Math.floor(barPx / step))

  return Array.from({ length: count }, (_, i) => ({ px: i * step, share: (i + 0.5) / count }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tape',
      description: 'Turn on the Tape Club deck for Spotify or Apple Music (off: /tape off)',
      argumentHint: '[off|close|keys|raster|vector]',
    })
    // A track on record means the deck was in use when the mod reloaded: it
    // stays on. Otherwise what is drawn would never be refreshed again.
    if ((await read($, now)) !== null) {
      await update($, isOn, () => true)
    }

    $.clock.every(POLL_MS, () => void refresh($))
    void refresh($)

    return next(e)
  })

  on('command.run', { command: 'tape' }, async ($, e) => {
    const arg = e.args.trim()

    if (arg === 'off') {
      await update($, isOn, () => false)
      // With nothing playing as far as the drawing knows, the band steps aside.
      await update($, now, () => null)
      await update($, beat, () => null)
      await $.ui.close({ id: PANE })

      return { text: 'Tape Club is off in this session. /tape turns it back on.' }
    }

    if (arg === 'close') {
      await $.ui.close({ id: PANE })

      return { text: 'Tape Club deck closed; the band stays. /tape off turns it off.' }
    }

    await update($, isOn, () => true)

    if (arg === 'keys') {
      await update($, hasKeys, shown => !shown)
    }

    if (arg === 'raster' || arg === 'vector') {
      await update($, art, () => arg)
    }

    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'Tape Club', columns: 46 })

    return { text: opened.isPlaced ? 'Tape Club deck opened.' : 'Tape Club is waiting for room to open.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const tape = await read($, now)
    const pet = await read($, hasPet)
    const tracks = tape?.tracks ?? []

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          <Text bold>{tape ? tape.name : 'Nothing playing'}</Text>
          <Text dimColor>{tape ? tape.artist : 'Press play in Spotify or Music'}</Text>
          <Box gap={1}>
            <Button key="prev" label="prev" onPress={() => tell($, 'previous track')} />
            <Button key="play" label={tape?.isPlaying ? 'pause' : 'play'} onPress={() => tell($, 'playpause')} />
            <Button key="next" label="next" onPress={() => tell($, 'next track')} />
          </Box>
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const at = await $.clock.now()
    const position = tape ? positionAt(tape, at) : 0
    const scene = { now: tape, beat: await read($, beat), at, position, art: await read($, art), hasPet: pet }
    // A column of the pane is a little over 7 px wide here; leave a margin.
    const width = Math.max(300, Math.min(520, Math.floor(e.props.bodyColumns * 7) - 20))
    const height = Math.round((width * DECK_HEIGHT) / DECK_WIDTH)
    const label = tape ? `${tape.name} by ${tape.artist}` : 'Tape Club deck, nothing playing'
    const keys = await read($, hasKeys)
    const hit = await read($, pressed)
    const scale = width / DECK_WIDTH
    const rows = Math.max(1, Math.floor((KEYS_HEIGHT * scale) / CELL.height))

    return (
      <Box flexDirection="column" alignItems="center" gap={1}>
        <Box flexDirection="column">
          <Svg source={drawDeck(scene)} alt={label} width={width} height={height} />
          {seekStops(320 * scale).map((stop, i) => (
            <Box
              position="absolute"
              top={Math.floor((306 * scale) / CELL.height)}
              left={Math.round((20 * scale + stop.px) / CELL.width)}
            >
              <Button key={`seek-${i}`} plain label={BLANK} onPress={() => seekTo($, stop.share)} />
            </Box>
          ))}
        </Box>
        {keys && (
          <Box flexDirection="column">
            <Svg source={drawKeys(tape?.isPlaying ?? false, hit ? { slot: hit.slot, age: ((await $.clock.now()) - hit.at) / 1000 } : undefined)} alt="Transport keys" width={width} height={Math.round(KEYS_HEIGHT * scale)} />
            {KEY_SLOTS.map((slot, column) => (
              <Box
                position="absolute"
                top={0}
                left={Math.round((slot.x * scale) / CELL.width)}
                flexDirection="column"
              >
                {Array.from({ length: rows }, (_, row) => (
                  <Button
                    key={`over-${column}-${row}`}
                    plain
                    label={BLANK.repeat(Math.max(1, Math.round((slot.width * scale - BLANK_BUTTON.padding) / BLANK_BUTTON.glyph)))}
                    onPress={() => pressKey($, column, slot.command)}
                  />
                ))}
              </Box>
            ))}
          </Box>
        )}
        {!keys && (
          <Box gap={1} justifyContent="center">
            <Button key="prev" label="◀◀" onPress={() => tell($, 'previous track')} />
            <Button
              key="play"
              variant="primary"
              label={tape?.isPlaying ? '❚❚ Pause' : '▶ Play'}
              onPress={() => tell($, 'playpause')}
            />
            <Button key="next" label="▶▶" onPress={() => tell($, 'next track')} />
          </Box>
        )}
        <Box flexDirection="column">
          {tracks.map(track => (
            <Box justifyContent="space-between">
              <Button
                key={`track-${track.index}`}
                plain
                dimColor={track.index !== tape?.index}
                label={`${String(track.index).padStart(2, '0')}  ${track.name}`}
                onPress={() => tell($, `play track ${track.index} of current playlist`)}
              />
              <Text dimColor>{track.time}</Text>
            </Box>
          ))}
        </Box>
        <Box gap={1}>
          <Text dimColor>Little rituals</Text>
          <Button
            key="pet"
            plain
            label={pet ? 'Desk pet: on' : 'Desk pet: off'}
            onPress={() => update($, hasPet, shown => !shown)}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const tape = await read($, now)

    if (e.props.hasSurvey || tape === null || !(await read($, isOn))) {
      return next(e)
    }

    if (e.surface !== 'desktop') {
      const { Box, Text, Button } = $.ui.resolve(e)

      return (
        <Box gap={1}>
          <Text>
            {tape.isPlaying ? '♪' : '❚❚'} {tape.name}
          </Text>
          <Text dimColor>{tape.artist}</Text>
          <Button key="band-prev" plain label="◀◀" onPress={() => tell($, 'previous track')} />
          <Button key="band-play" plain label={tape.isPlaying ? '❚❚' : '▶'} onPress={() => tell($, 'playpause')} />
          <Button key="band-next" plain label="▶▶" onPress={() => tell($, 'next track')} />
          <Button key="band-open" plain label="deck" onPress={() => $.ui.open({ id: PANE, title: 'Tape Club', columns: 46 })} />
        </Box>
      )
    }

    // The desktop band is one drawing, its keys pressed through blank Buttons
    // laid over them, as on the deck.
    const { Box, Button, Svg } = $.ui.resolve(e)
    const at = await $.clock.now()
    // Measured on the desktop: 95 columns of the band are 749 px across.
    const width = Math.max(360, Math.floor(e.props.bodyColumns * BAND_COLUMN_PX))
    const hit = await read($, pressed)
    const pet = await read($, hasPet)
    const scene = { now: tape, beat: await read($, beat), at, position: positionAt(tape, at), art: await read($, art), hasPet: pet }
    const rows = Math.floor(BAND_HEIGHT / CELL.height)
    const bar = bandBar(width, pet)

    return (
      <Box flexDirection="column">
        <Svg
          source={drawBand(scene, width, hit ? { slot: hit.slot, age: (at - hit.at) / 1000 } : undefined)}
          alt={`${tape.name} by ${tape.artist}`}
          width={width}
          height={BAND_HEIGHT}
        />
        {bandSlots(width).map(slot => (
          <Box position="absolute" top={0} left={Math.round(slot.x / CELL.width)} flexDirection="column">
            {Array.from({ length: rows }, (_, row) => (
              <Button
                key={`band-${slot.slot}-${row}`}
                plain
                label={BLANK.repeat(Math.max(1, Math.round((slot.width - BLANK_BUTTON.padding) / BLANK_BUTTON.glyph)))}
                onPress={() => pressKey($, slot.slot, slot.command)}
              />
            ))}
          </Box>
        ))}
        {seekStops(bar.right - bar.left).map((stop, i) => (
          <Box
            position="absolute"
            top={Math.floor(bar.y / CELL.height)}
            left={Math.round((bar.left + stop.px) / CELL.width)}
          >
            <Button key={`band-seek-${i}`} plain label={BLANK} onPress={() => seekTo($, stop.share)} />
          </Box>
        ))}
      </Box>
    )
  })
}
