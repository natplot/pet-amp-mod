import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TapeBeat, TapeNow, TapePetChoice, TapeTrack } from '../types'

import {
  BAND_HEIGHT,
  DECK_WIDTH,
  TAPE_LAYOUT,
  bandBar,
  bandSlots,
  drawBand,
  drawDeck,
  drawKeys,
  PETS,
  type PetArt,
} from './art'
import { AMP_LAYOUT, drawAmpBand, drawAmpDeck, drawAmpKeys } from './amp'

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
// Which look: the olive cassette deck, or ClaudeAmp '98.
const skin = atom({ plugin: 'tape-club', key: 'skin' } as const, 'tape')
const now = atom({ plugin: 'tape-club', key: 'now' } as const, null)
const art = atom({ plugin: 'tape-club', key: 'art' } as const, 'raster')
// Kept from before the pet switch: `false` meant the pet was switched off.
const hasPet = atom({ plugin: 'tape-club', key: 'hasPet' } as const, true)
const petChoice = atom({ plugin: 'tape-club', key: 'petChoice' } as const, 'skin')
const beat = atom({ plugin: 'tape-club', key: 'beat' } as const, null)
const pressed = atom({ plugin: 'tape-club', key: 'pressed' } as const, null)
const hasKeys = atom({ plugin: 'tape-club', key: 'hasKeys' } as const, true)

// The player the deck drives: Spotify when it has a track, else Music. Each is
// asked in its own osascript run, since a script naming an app that is not
// installed does not compile.
type Player = 'Spotify' | 'Music'
let player: Player = 'Spotify'

// Spotify reports duration in ms, carries no tempo and shows no playlist. Its
// repeat is on or off, written here in Music's words: all or off.
const SPOTIFY_SNAPSHOT = `
if application "Spotify" is not running then return "off"
tell application "Spotify"
  set ps to player state as text
  if ps is "stopped" then return "stopped"
  set t to current track
  set rp to "off"
  if repeating then set rp to "all"
  return ps & linefeed & (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & ((duration of t) / 1000) & linefeed & (player position) & linefeed & 0 & linefeed & (sound volume) & linefeed & (shuffling) & linefeed & rp
end tell`

// Asks Music only while it runs, so a poll never launches the app. One field
// per line, then the current track's neighbours as index, name and time.
const MUSIC_SNAPSHOT = `
if application "Music" is not running then return "off"
tell application "Music"
  set ps to player state as text
  if ps is "stopped" then return "stopped"
  set t to current track
  set res to ps & linefeed & (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & (duration of t) & linefeed & (player position) & linefeed & (bpm of t) & linefeed & (sound volume) & linefeed & (shuffle enabled) & linefeed & (song repeat as text)
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

  const tracks: TapeTrack[] = lines.slice(12).flatMap(line => {
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
    volume: number(lines[7]),
    shuffle: lines[8] === 'true',
    repeat: lines[9] ?? 'off',
    playlist: lines[10] ?? '',
    index: number(lines[11]),
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
    a.volume === b.volume &&
    a.shuffle === b.shuffle &&
    a.repeat === b.repeat &&
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

  const tape = await read($, now)

  if (command === 'deck') {
    await $.ui.open({ id: PANE, title: 'Tape Club', columns: 46 })
  } else if (command.startsWith('volume:')) {
    await tell($, `set sound volume to ${Number(command.slice('volume:'.length))}`)
  } else if (command === 'shuffle') {
    // The two players name these differently.
    const setting = player === 'Spotify' ? 'shuffling' : 'shuffle enabled'
    await tell($, `set ${setting} to ${!(tape?.shuffle ?? false)}`)
  } else if (command === 'repeat') {
    const isOff = (tape?.repeat ?? 'off') === 'off'
    await tell($, player === 'Spotify' ? `set repeating to ${isOff}` : `set song repeat to ${isOff ? 'all' : 'off'}`)
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

const PET_CHOICES = ['calico', 'ginger', 'cavapoo', 'none'] as const
const PET_LABELS: Record<(typeof PET_CHOICES)[number], string> = {
  calico: 'Calico',
  ginger: 'Ginger',
  cavapoo: 'Cavapoo',
  none: 'None',
}

/** The pet to draw: the one chosen, or the skin's own cat until one is chosen. */
async function petOf($: EngineInterface, isAmp: boolean): Promise<{ art: PetArt | null; name: TapePetChoice }> {
  const choice = await read($, petChoice)

  if (choice === 'none' || (choice === 'skin' && !(await read($, hasPet)))) {
    return { art: null, name: 'none' }
  }

  const name = choice === 'skin' ? (isAmp ? 'ginger' : 'calico') : choice

  return { art: PETS[name], name }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tape',
      description: 'Turn on the Tape Club deck for Spotify or Apple Music (off: /tape off)',
      argumentHint: '[skin tape|amp] [pet calico|ginger|cavapoo|none] [off|close|keys]',
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

    // `/tape amp` and `/tape skin amp` both switch the skin; `/tape pet cavapoo` the pet.
    const [first, second] = arg.split(/\s+/)
    const skinName = first === 'skin' ? second : first

    if (skinName === 'tape' || skinName === 'amp') {
      await update($, skin, () => skinName)
    }

    if (first === 'pet' && (second === 'skin' || PET_CHOICES.some(name => name === second))) {
      await update($, petChoice, () => second as TapePetChoice)
    }

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
    const isAmp = (await read($, skin)) === 'amp'
    const pet = await petOf($, isAmp)
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
    const scene = { now: tape, beat: await read($, beat), at, position, art: await read($, art), pet: pet.art }
    const layout = isAmp ? AMP_LAYOUT : TAPE_LAYOUT
    // A column of the pane is a little over 7 px wide here; leave a margin.
    const width = Math.max(300, Math.min(520, Math.floor(e.props.bodyColumns * 7) - 20))
    const height = Math.round((width * layout.height) / DECK_WIDTH)
    const label = tape ? `${tape.name} by ${tape.artist}` : 'Tape Club deck, nothing playing'
    const keys = await read($, hasKeys)
    const hit = await read($, pressed)
    const scale = width / DECK_WIDTH
    const press = hit ? { slot: hit.slot, age: (at - hit.at) / 1000 } : undefined
    // Blank Buttons over a part of a drawing: as many rows as cover it, as wide as it is.
    const over = (part: { x: number; y: number; w: number; h: number }, top = 0) => {
      const first = Math.floor((top + part.y * scale) / CELL.height)
      const last = Math.max(first + 1, Math.round((top + (part.y + part.h) * scale) / CELL.height))

      return { top: first, rows: last - first, left: Math.round((part.x * scale) / CELL.width), glyphs: Math.max(1, Math.round((part.w * scale - BLANK_BUTTON.padding) / BLANK_BUTTON.glyph)) }
    }

    return (
      <Box flexDirection="column" alignItems="center" gap={1}>
        {/* The deck and its key strip touch: in ClaudeAmp they are one window. */}
        <Box flexDirection="column">
          <Box flexDirection="column">
            <Svg source={isAmp ? drawAmpDeck(scene) : drawDeck(scene)} alt={label} width={width} height={height} />
            {seekStops((layout.seek.x2 - layout.seek.x1) * scale).map((stop, i) => (
              <Box
                position="absolute"
                top={Math.floor((layout.seek.y * scale) / CELL.height)}
                left={Math.round((layout.seek.x1 * scale + stop.px) / CELL.width)}
              >
                <Button key={`seek-${i}`} plain label={BLANK} onPress={() => seekTo($, stop.share)} />
              </Box>
            ))}
          </Box>
          {keys && (
            <Box flexDirection="column">
              <Svg
                source={isAmp ? drawAmpKeys(tape, press) : drawKeys(tape?.isPlaying ?? false, press)}
                alt="Transport keys"
                width={width}
                height={Math.round(layout.keysHeight * scale)}
              />
              {layout.keyHits.map((part, slot) => {
                const place = over(part)

                return (
                  <Box position="absolute" top={place.top} left={place.left} flexDirection="column">
                    {Array.from({ length: place.rows }, (_, row) => (
                      <Button
                        key={`over-${slot}-${row}`}
                        plain
                        label={BLANK.repeat(place.glyphs)}
                        onPress={() => pressKey($, slot, part.action)}
                      />
                    ))}
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
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
        {/* Two switches: the skin, and the pet, chosen apart from each other. */}
        <Box gap={1}>
          <Text dimColor>Skin</Text>
          {(['tape', 'amp'] as const).map(name => (
            <Button
              key={`skin-${name}`}
              plain
              dimColor={isAmp !== (name === 'amp')}
              label={`${isAmp === (name === 'amp') ? '●' : '○'} ${name === 'amp' ? "ClaudeAmp '98" : 'Tape Club'}`}
              onPress={() => update($, skin, () => name)}
            />
          ))}
        </Box>
        <Box gap={1}>
          <Text dimColor>Pet</Text>
          {PET_CHOICES.map(name => (
            <Button
              key={`pet-${name}`}
              plain
              dimColor={pet.name !== name}
              label={`${pet.name === name ? '●' : '○'} ${PET_LABELS[name]}`}
              onPress={() => update($, petChoice, () => name)}
            />
          ))}
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
    const isAmp = (await read($, skin)) === 'amp'
    const pet = await petOf($, isAmp)
    const scene = { now: tape, beat: await read($, beat), at, position: positionAt(tape, at), art: await read($, art), pet: pet.art }
    const rows = Math.floor(BAND_HEIGHT / CELL.height)
    const bar = bandBar(width, pet.art)

    return (
      <Box flexDirection="column">
        <Svg
          source={(isAmp ? drawAmpBand : drawBand)(scene, width, hit ? { slot: hit.slot, age: (at - hit.at) / 1000 } : undefined)}
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
