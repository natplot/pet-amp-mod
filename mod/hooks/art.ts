import type { TapeArt, TapeBeat, TapeNow } from '../types'

import { CAT_BODY, CAT_GRID, CAT_HEAD, CAT_HEAD_PIVOT, CAT_PAW_CLIP, CAT_PAW_LEFT, CAT_PAW_RIGHT, CAT_TAIL, CAT_TAIL_PIVOT, ENAMEL, HUB, HUB_SMALL, SHELL, SHELL_SMALL } from './assets'

const INK = '#fff7e7'
const ACCENT = '#d9683f'
const SIGNAL = '#b9cb89'
const FALLBACK_BPM = 100

// The cassette's box inside the 360-wide drawing, and the reel centres
// measured on the shell image (as fractions of that box).
const CASS = { x: 20, y: 20, w: 320, h: 192.3 }
const REELS = [0.2741, 0.723].map(fx => CASS.x + fx * CASS.w)
const REEL_Y = CASS.y + 0.4842 * CASS.h
const HUB_SIZE = 0.1988 * CASS.w

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

// A redraw replaces the drawing, so every loop begins where the clock says it
// already is: `begin` is how far into its cycle the loop stands, negated.
const into = (cycle: number, at: number) => `begin="${(-(((at % cycle) + cycle) % cycle)).toFixed(3)}s"`

const spin = (seconds: number, at: number) =>
  `<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${seconds}s" ${into(seconds, at)} repeatCount="indefinite"/>`

function rasterHub(cx: number, seconds: number, turning: number | null) {
  // The pivot of the hub image sits a hair off its centre (cassette-hub.json).
  return `<g transform="translate(${cx} ${REEL_Y})"><image href="${HUB}" x="${-HUB_SIZE * 0.49885}" y="${-HUB_SIZE * 0.49431}" width="${HUB_SIZE}" height="${HUB_SIZE}">${turning === null ? '' : spin(seconds, turning)}</image></g>`
}

function vectorHub(cx: number, seconds: number, turning: number | null) {
  const teeth = [0, 60, 120, 180, 240, 300]
    .map(a => `<rect x="-3.2" y="-17" width="6.4" height="7.5" rx="1.2" fill="url(#hub)" stroke="#b9b193" stroke-width=".5" transform="rotate(${a})"/>`)
    .join('')

  return (
    `<g transform="translate(${cx} ${REEL_Y})">` +
    `<circle r="31" fill="#5d6748" stroke="#39412c"/>` +
    `<g><circle r="26.5" fill="url(#hub)" stroke="#fbf5e2" stroke-width=".8"/><circle r="20" fill="none" stroke="#c9c1a4" stroke-width=".8"/><circle r="16" fill="#191d14"/>${teeth}${turning === null ? '' : spin(seconds, turning)}</g>` +
    `</g>`
  )
}

const screw = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><circle r="4.2" fill="#3a3f30" stroke="#20241a"/><path d="M-2.4 0h4.8M0 -2.4v4.8" stroke="#8c917c" stroke-width="1.1"/></g>`

function vectorShell() {
  const { x, y, w, h } = CASS
  const foot = y + h - 8

  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="url(#shell)" stroke="#2b3122"/>` +
    `<rect x="${x + 2.5}" y="${y + 2.5}" width="${w - 5}" height="${h - 5}" rx="7" fill="none" stroke="#fff7e7" stroke-opacity=".12"/>` +
    // the paper label, its olive band, and the dark window the reels sit in
    `<rect x="${x + 16}" y="${y + 13}" width="${w - 32}" height="133" rx="6" fill="url(#paper)" stroke="#3d4332" stroke-opacity=".35"/>` +
    `<path d="M${x + 16} ${y + 124}h${w - 32}v16a6 6 0 0 1 -6 6h-${w - 44}a6 6 0 0 1 -6 -6z" fill="#8f987a"/>` +
    `<rect x="${x + 52}" y="${y + 60}" width="${w - 104}" height="66" rx="8" fill="#26251f" stroke="#15150f"/>` +
    `<circle cx="${REELS[0]}" cy="${REEL_Y}" r="40" fill="#171512" clip-path="url(#window)"/>` +
    `<circle cx="${REELS[1]}" cy="${REEL_Y}" r="35" fill="#171512" clip-path="url(#window)"/>` +
    `<rect x="151" y="${y + 68}" width="58" height="50" rx="3" fill="#4d4a40" opacity=".55"/>` +
    // the foot: tape guides and the centre screw
    `<path d="M${x + 60} ${foot}l13 -34h${w - 146}l13 34z" fill="#525b40" stroke="#2b3122"/>` +
    `<circle cx="${x + 100}" cy="${foot - 14}" r="6" fill="#1b2016"/><circle cx="${x + w - 100}" cy="${foot - 14}" r="6" fill="#1b2016"/>` +
    `<rect x="${x + 126}" y="${foot - 20}" width="11" height="11" rx="2.5" fill="#1b2016"/><rect x="${x + w - 137}" y="${foot - 20}" width="11" height="11" rx="2.5" fill="#1b2016"/>` +
    screw(180, foot - 15) +
    [x + 11, x + w - 11].flatMap(sx => [y + 11, y + h - 11].map(sy => screw(sx, sy))).join('')
  )
}

function cassette(art: TapeArt, turning: number | null, label: string) {
  const { x, y, w, h } = CASS
  const shell =
    art === 'raster'
      ? `<image href="${SHELL}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`
      : vectorShell()
  const hub = art === 'raster' ? rasterHub : vectorHub

  return (
    `<rect x="10" y="10" width="340" height="212" rx="11" fill="#20261a" stroke="#141810"/>` +
    shell +
    hub(REELS[0]!, 4, turning) +
    hub(REELS[1]!, 2.6, turning) +
    `<g stroke="${ACCENT}" stroke-width="1.4" opacity=".85"><path d="M176 105v16M180 105v16M184 105v16"/></g>` +
    `<line x1="${x + 28}" y1="${y + 51}" x2="${x + w - 28}" y2="${y + 51}" stroke="#3d4332" stroke-opacity=".25"/>` +
    `<text x="180" y="${y + 43}" text-anchor="middle" font-family="'Bradley Hand','Segoe Print',cursive" font-size="17" fill="#3d4332">${escapeXml(clip(label, 30))}</text>` +
    `<text x="${x + 30}" y="${REEL_Y + 6}" font-family="-apple-system,sans-serif" font-size="15" fill="#55594a">A</text>` +
    `<text x="${x + w - 30}" y="${REEL_Y + 6}" text-anchor="end" font-family="-apple-system,sans-serif" font-size="15" fill="#55594a">60</text>` +
    `<text x="180" y="${y + 0.71 * h}" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="6.5" letter-spacing="2" fill="#2e3526">TAPE CLUB</text>`
  )
}

function meter(x: number, pulse: Pulse | null) {
  return [0, 1, 2, 3]
    .map(i => {
      // Bars tall on the beat: the first on every beat, the rest on fractions of it.
      const cycle = pulse ? pulse.period * [1, 0.5, 0.75, 0.66][i]! : 0
      const loop = pulse ? `dur="${cycle.toFixed(3)}s" ${into(cycle, pulse.sinceBar)} repeatCount="indefinite"` : ''
      const sway = pulse
        ? `<animate attributeName="height" values="16;4;16" ${loop}/><animate attributeName="y" values="276;288;276" ${loop}/>`
        : ''

      return `<rect x="${x + i * 7}" y="288" width="4" height="4" fill="${SIGNAL}" opacity=".8">${sway}</rect>`
    })
    .join('')
}

function cat(pulse: Pulse | null) {
  const size = 68
  const scale = size / CAT_GRID
  const [px, py] = CAT_TAIL_PIVOT
  const ease = 'calcMode="spline" keySplines="0.3 0 0.2 1;0.3 0 0.2 1"'
  const over = (beats: number) =>
    pulse
      ? `dur="${(pulse.period * beats).toFixed(3)}s" ${into(pulse.period * beats, pulse.sinceBar)} repeatCount="indefinite"`
      : ''
  // One swing per beat: the tail reaches one side on a beat and the other on the next.
  const wag = pulse
    ? `<animateTransform attributeName="transform" type="rotate" values="-7 ${px} ${py};8 ${px} ${py};-7 ${px} ${py}" keyTimes="0;0.5;1" ${ease} ${over(2)}/>`
    : ''
  // The body rises a touch between beats and is back down on the beat.
  const bob = pulse
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -9;0 0" keyTimes="0;0.5;1" ${ease} ${over(1)}/>`
    : ''
  // The front paws tap in turn over two beats: the left one lands on the first
  // beat of the pair, the right one on the second; each lifts just before.
  const pair = over(2)
  // The head leans to one side for two beats, then to the other.
  const [hx, hy] = CAT_HEAD_PIVOT
  const sway = pulse
    ? `<animateTransform attributeName="transform" type="rotate" values="-2.5 ${hx} ${hy};2.5 ${hx} ${hy};-2.5 ${hx} ${hy}" keyTimes="0;0.5;1" ${ease} ${over(4)}/>`
    : ''
  const tapLeft = pulse
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -50;0 -50;0 0" keyTimes="0;0.5;0.66;0.86;1" ${pair}/>`
    : ''
  const tapRight = pulse
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -50;0 -50;0 0;0 0" keyTimes="0;0.16;0.36;0.5;1" ${pair}/>`
    : ''

  // Paws rest on the progress bar at y=306; the cat's lowest pixel is
  // at 0.913 of its canvas.
  return (
    `<g transform="translate(280 ${306 - 0.913 * size}) scale(${scale})">` +
    `<g>${CAT_TAIL}${wag}</g>` +
    `<g>${bob}${CAT_BODY}<g>${CAT_HEAD}${sway}</g>${CAT_PAW_CLIP}<g clip-path="url(#cp0)">${CAT_PAW_LEFT}${tapLeft}</g><g clip-path="url(#cp1)">${CAT_PAW_RIGHT}${tapRight}</g></g>` +
    `</g>`
  )
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/** The beat as the drawing needs it: its period, and how far the clock stands
 *  past the beat that opened a bar of four, in seconds. The meter and the body
 *  move over one beat, the tail and the paws over two, the head over four. */
type Pulse = { period: number; sinceBar: number }

function pulseAt(now: TapeNow | null, beat: TapeBeat | null, at: number): Pulse | null {
  if (!now?.isPlaying) {
    return null
  }

  // No beat from Mac Pulse: fall back to the track's tempo tag, then to a guess.
  const period = 60 / (beat ? beat.bpm : now.bpm > 0 ? now.bpm : FALLBACK_BPM)

  return { period, sinceBar: at - (beat ? beat.barAt / 1000 : 0) }
}

export type Scene = {
  now: TapeNow | null
  beat: TapeBeat | null
  /** Clock time of the drawing, in ms. */
  at: number
  /** Seconds into the track at the moment of drawing. */
  position: number
  art: TapeArt
  hasPet: boolean
}

/** The deck is drawn 360 wide; the frame it is shown in keeps this shape. */
export const DECK_WIDTH = 360
export const DECK_HEIGHT = 334

// One drawing, shown as an image (not interactive): the desktop keeps embedded
// pictures only there, and its animation runs there too.
export function drawDeck({ now, beat, at, position, art, hasPet }: Scene): string {
  const isPlaying = now?.isPlaying ?? false
  const seconds = at / 1000
  const pulse = pulseAt(now, beat, seconds)
  const title = now ? now.name : 'Nothing playing'
  const sub = now ? now.artist || now.album : 'Press play to start Music'
  const done = now && now.duration > 0 ? Math.min(1, position / now.duration) : 0
  const left = now ? Math.max(0, now.duration - position) : 0
  const run =
    isPlaying && left > 1
      ? `<animate attributeName="width" from="${(320 * done).toFixed(1)}" to="320" dur="${left.toFixed(1)}s" fill="freeze"/>`
      : ''
  const ground =
    art === 'raster'
      ? `<image href="${ENAMEL}" width="${DECK_WIDTH}" height="${DECK_HEIGHT}" preserveAspectRatio="xMidYMid slice" clip-path="url(#deck)"/>`
      : `<rect width="${DECK_WIDTH}" height="${DECK_HEIGHT}" rx="13" fill="#566043"/>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DECK_WIDTH}" height="${DECK_HEIGHT}" viewBox="0 0 ${DECK_WIDTH} ${DECK_HEIGHT}">` +
    `<defs>` +
    `<linearGradient id="shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c7653"/><stop offset="1" stop-color="#4f593c"/></linearGradient>` +
    `<linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4ecd6"/><stop offset="1" stop-color="#e5dbc0"/></linearGradient>` +
    `<radialGradient id="hub" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#fbf5e2"/><stop offset="1" stop-color="#d6cdb0"/></radialGradient>` +
    `<clipPath id="window"><rect x="${CASS.x + 52}" y="${CASS.y + 60}" width="${CASS.w - 104}" height="66" rx="8"/></clipPath>` +
    `<clipPath id="deck"><rect width="${DECK_WIDTH}" height="${DECK_HEIGHT}" rx="13"/></clipPath>` +
    `</defs>` +
    ground +
    `<rect x=".5" y=".5" width="${DECK_WIDTH - 1}" height="${DECK_HEIGHT - 1}" rx="12.5" fill="none" stroke="#2b3122"/>` +
    `<rect x="1.5" y="1.5" width="${DECK_WIDTH - 3}" height="${DECK_HEIGHT - 3}" rx="11.5" fill="none" stroke="#fff7e7" stroke-opacity=".14"/>` +
    cassette(art, isPlaying ? seconds : null, now?.playlist || now?.album || 'good things take time ♡') +
    `<text x="20" y="266" font-family="Georgia,'Times New Roman',serif" font-size="24" fill="${INK}">${escapeXml(clip(title, hasPet ? 17 : 24))}</text>` +
    `<text x="20" y="288" font-family="-apple-system,sans-serif" font-size="12" letter-spacing="1" fill="${INK}" opacity=".8">${escapeXml(clip(sub, hasPet ? 28 : 40))}</text>` +
    meter(hasPet ? 244 : 314, pulse) +
    `<rect x="20" y="306" width="320" height="4" rx="2" fill="#141a0d" opacity=".5"/>` +
    `<rect x="20" y="306" width="${(320 * done).toFixed(1)}" height="4" rx="2" fill="${ACCENT}">${run}</rect>` +
    (hasPet ? cat(pulse) : '') +
    (now
      ? `<text x="20" y="326" font-family="-apple-system,sans-serif" font-size="11" letter-spacing="1" fill="${INK}" opacity=".85">${clock(position)}</text>` +
        `<text x="340" y="326" text-anchor="end" font-family="-apple-system,sans-serif" font-size="11" letter-spacing="1" fill="${INK}" opacity=".85">${clock(now.duration)}</text>`
      : '') +
    `</svg>`
  )
}

/** The key strip is drawn 360 wide like the deck; each key's left edge and width. */
export const KEYS_HEIGHT = 58
export const KEY_SLOTS = [
  { command: 'previous track', x: 20, width: 100 },
  { command: 'playpause', x: 130, width: 100 },
  { command: 'next track', x: 240, width: 100 },
] as const

const KEY_GLYPHS = {
  prev: 'M-2 -8v16l-12-8zM12 -8v16l-12-8z',
  next: 'M-12 -8v16l12-8zM2 -8v16l12-8z',
  play: 'M-6 -9v18l15-9z',
  pause: 'M-8 -8h6v16h-6zM2 -8h6v16h-6z',
}

const PRESS_SECONDS = 0.24

// Only a picture: the presses are taken by blank Buttons laid over it. A key
// pressed `age` seconds ago sinks onto its base and comes back; the negative
// `begin` picks the motion up where it stands when a redraw lands mid-press.
export function drawKeys(isPlaying: boolean, pressed?: { slot: number; age: number }): string {
  const glyphs = [KEY_GLYPHS.prev, isPlaying ? KEY_GLYPHS.pause : KEY_GLYPHS.play, KEY_GLYPHS.next]
  const keys = KEY_SLOTS.map((slot, i) => {
    const isHot = i === 1
    const sink =
      pressed && pressed.slot === i && pressed.age < PRESS_SECONDS
        ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 3;0 3;0 0" keyTimes="0;0.25;0.6;1" dur="${PRESS_SECONDS}s" begin="${(-pressed.age).toFixed(3)}s"/>`
        : ''

    return (
      `<rect x="${slot.x}" y="10" width="${slot.width}" height="42" rx="6" fill="#14170f"/>` +
      `<g>${sink}` +
      `<rect x="${slot.x + 0.5}" y="7.5" width="${slot.width - 1}" height="40" rx="5.5" fill="url(#${isHot ? 'hot' : 'key'})" stroke="#2b3122"/>` +
      `<path d="M${slot.x + 5} 9.5h${slot.width - 10}" stroke="#fff" stroke-opacity=".45"/>` +
      `<path transform="translate(${slot.x + slot.width / 2} 27.5)" d="${glyphs[i]}" fill="${isHot ? INK : '#23281b'}"/>` +
      `</g>`
    )
  }).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DECK_WIDTH}" height="${KEYS_HEIGHT}" viewBox="0 0 ${DECK_WIDTH} ${KEYS_HEIGHT}">` +
    `<defs>` +
    `<linearGradient id="key" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bdb99a"/><stop offset="1" stop-color="#8f8d70"/></linearGradient>` +
    `<linearGradient id="hot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d2693f"/><stop offset="1" stop-color="#a94a2a"/></linearGradient>` +
    `</defs>` +
    `<rect width="${DECK_WIDTH}" height="${KEYS_HEIGHT}" rx="13" fill="#566043" stroke="#2b3122"/>` +
    keys +
    `</svg>`
  )
}

/** The band above the prompt: one row, drawn 1:1 in px at whatever width it is given. */
export const BAND_HEIGHT = 113
const BAND_KEY = { width: 52, height: 50, gap: 6, margin: 10 }
// The cassette in the band: the deck's shell, small, with its reels at the same spots.
const BAND_CASS = { x: 7, y: 6, w: 168, h: 101 }
/** Slots count on from the deck's three, so one `pressed` value serves both. */
export const BAND_SLOT_BASE = 10
const BAND_COMMANDS = ['previous track', 'playpause', 'next track', 'deck'] as const

/** Where the band's keys sit, left to right: transport, then the key that opens the deck. */
export function bandSlots(width: number) {
  return BAND_COMMANDS.map((command, i) => ({
    command,
    slot: BAND_SLOT_BASE + i,
    x: width - BAND_KEY.margin - (BAND_COMMANDS.length - i) * BAND_KEY.width - (BAND_COMMANDS.length - 1 - i) * BAND_KEY.gap,
    width: BAND_KEY.width,
  }))
}

function bandReel(fx: number, seconds: number, turning: number | null) {
  const { x, y, w, h } = BAND_CASS
  const size = 0.1988 * w

  return `<g transform="translate(${x + fx * w} ${y + 0.4842 * h})"><image href="${HUB_SMALL}" x="${-size * 0.49885}" y="${-size * 0.49431}" width="${size}" height="${size}">${turning === null ? '' : spin(seconds, turning)}</image></g>`
}

// Drawn when raster art is off: a plain shell with two turning reels.
function bandReelVector(fx: number, seconds: number, turning: number | null) {
  const { x, y, w, h } = BAND_CASS
  const spokes = [0, 120, 240]
    .map(a => `<rect x="-1.4" y="-8" width="2.8" height="4.5" fill="#e9dfc4" transform="rotate(${a})"/>`)
    .join('')

  return `<g transform="translate(${x + fx * w} ${y + 0.4842 * h})"><circle r="11.5" fill="#171512"/><g><circle r="9.5" fill="#e9dfc4" stroke="#fbf5e2" stroke-width=".5"/><circle r="5.4" fill="#191d14"/>${spokes}${turning === null ? '' : spin(seconds, turning)}</g></g>`
}

function bandCassette(art: TapeArt, turning: number | null, label: string) {
  const { x, y, w, h } = BAND_CASS
  const reel = art === 'raster' ? bandReel : bandReelVector
  const shell =
    art === 'raster'
      ? `<image href="${SHELL_SMALL}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="#5d6748" stroke="#2b3122"/>` +
        `<rect x="${x + 6}" y="${y + 5}" width="${w - 12}" height="${h * 0.66}" rx="3" fill="url(#paper)"/>` +
        `<rect x="${x + 17}" y="${y + 19}" width="${w - 34}" height="21" rx="4" fill="#26251f"/>`

  const reelY = y + 0.4842 * h
  const side = (text: string, fx: number, anchor: string) =>
    `<text x="${x + fx * w}" y="${reelY + 3}" text-anchor="${anchor}" font-family="-apple-system,sans-serif" font-size="8" fill="#55594a">${text}</text>`

  return (
    shell +
    reel(0.2741, 4, turning) +
    reel(0.723, 2.6, turning) +
    `<g stroke="${ACCENT}" stroke-width=".8" opacity=".85"><path d="M${x + w / 2 - 2} ${reelY - 4}v8M${x + w / 2} ${reelY - 4}v8M${x + w / 2 + 2} ${reelY - 4}v8"/></g>` +
    `<text x="${x + w / 2}" y="${y + 0.225 * h}" text-anchor="middle" font-family="'Bradley Hand','Segoe Print',cursive" font-size="9.5" fill="#3d4332">${escapeXml(clip(label, 26))}</text>` +
    side('A', 0.094, 'start') +
    side('60', 0.906, 'end')
  )
}

/** Where the band's progress bar runs, in px: the seek Buttons are laid over it. */
export function bandBar(width: number, hasPet: boolean) {
  const keysLeft = bandSlots(width)[0]!.x
  const left = BAND_CASS.x + BAND_CASS.w + 14

  return { left, right: keysLeft - (hasPet ? BAND_CAT.room : 6) - 10, y: 74 }
}

// The cat stands as tall as the band allows, the same margin above its ears as
// under its paws: it is drawn over 0.797 of its canvas, from 0.116 down.
const BAND_CAT = { margin: 6, room: Math.round(((BAND_HEIGHT - 12) / 0.797) * 0.78) + 4 }

export function drawBand(
  { now, beat, at, position, art, hasPet }: Scene,
  width: number,
  pressed?: { slot: number; age: number },
): string {
  const isPlaying = now?.isPlaying ?? false
  const seconds = at / 1000
  const pulse = pulseAt(now, beat, seconds)
  const slots = bandSlots(width)
  const keysLeft = slots[0]!.x
  // Right to left before the keys: the cat, then the meter; the text takes what is left.
  const catLeft = keysLeft - (hasPet ? BAND_CAT.room : 6)
  const bar = bandBar(width, hasPet)
  const textLeft = bar.left
  const span = bar.right - bar.left
  const room = Math.max(4, Math.floor(span / 11.6))
  const done = now && now.duration > 0 ? Math.min(1, position / now.duration) : 0
  const left = now ? Math.max(0, now.duration - position) : 0
  const run =
    isPlaying && left > 1
      ? `<animate attributeName="width" from="${(span * done).toFixed(1)}" to="${span}" dur="${left.toFixed(1)}s" fill="freeze"/>`
      : ''
  const glyphs = [KEY_GLYPHS.prev, isPlaying ? KEY_GLYPHS.pause : KEY_GLYPHS.play, KEY_GLYPHS.next]
  const keys = slots.map((slot, i) => {
    const isHot = i === 1
    const sink =
      pressed && pressed.slot === slot.slot && pressed.age < PRESS_SECONDS
        ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 3;0 3;0 0" keyTimes="0;0.25;0.6;1" dur="${PRESS_SECONDS}s" begin="${(-pressed.age).toFixed(3)}s"/>`
        : ''
    const mid = slot.x + slot.width / 2
    const top = (BAND_HEIGHT - BAND_KEY.height) / 2 - 1.5
    const centre = top + BAND_KEY.height / 2 - 1
    const face =
      slot.command === 'deck'
        ? `<rect x="${mid - 14}" y="${centre - 9.5}" width="28" height="19" rx="2.5" fill="none" stroke="#23281b" stroke-width="1.9"/><circle cx="${mid - 5.5}" cy="${centre}" r="2.8" fill="#23281b"/><circle cx="${mid + 5.5}" cy="${centre}" r="2.8" fill="#23281b"/>`
        : `<path transform="translate(${mid} ${centre}) scale(1.1)" d="${glyphs[i]}" fill="${isHot ? INK : '#23281b'}"/>`

    return (
      `<rect x="${slot.x}" y="${top + 2.5}" width="${slot.width}" height="${BAND_KEY.height}" rx="6" fill="#14170f"/>` +
      `<g>${sink}<rect x="${slot.x + 0.5}" y="${top}" width="${slot.width - 1}" height="${BAND_KEY.height - 2}" rx="5.5" fill="url(#${isHot ? 'hot' : 'key'})" stroke="#2b3122"/>` +
      `<path d="M${slot.x + 5} ${top + 2}h${slot.width - 10}" stroke="#fff" stroke-opacity=".45"/>${face}</g>`
    )
  }).join('')
  const ground =
    art === 'raster'
      ? `<image href="${ENAMEL}" width="${width}" height="${BAND_HEIGHT}" preserveAspectRatio="xMidYMid slice" clip-path="url(#band)"/>`
      : `<rect width="${width}" height="${BAND_HEIGHT}" rx="11" fill="#566043"/>`
  // The cat is the deck's, resized: its paws at (280, 306) there land on the
  // band's floor here, and its ears stop one margin short of the top.
  const shrink = (BAND_HEIGHT - 2 * BAND_CAT.margin) / 0.797 / 68
  const pet = hasPet
    ? `<g transform="translate(${catLeft - 0.13 * 68 * shrink - 280 * shrink} ${BAND_HEIGHT - BAND_CAT.margin - 306 * shrink}) scale(${shrink})">${cat(pulse)}</g>`
    : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAND_HEIGHT}" viewBox="0 0 ${width} ${BAND_HEIGHT}">` +
    `<defs>` +
    `<linearGradient id="key" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bdb99a"/><stop offset="1" stop-color="#8f8d70"/></linearGradient>` +
    `<linearGradient id="hot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d2693f"/><stop offset="1" stop-color="#a94a2a"/></linearGradient>` +
    `<linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4ecd6"/><stop offset="1" stop-color="#e5dbc0"/></linearGradient>` +
    `<clipPath id="band"><rect width="${width}" height="${BAND_HEIGHT}" rx="11"/></clipPath>` +
    `</defs>` +
    ground +
    `<rect x=".5" y=".5" width="${width - 1}" height="${BAND_HEIGHT - 1}" rx="10.5" fill="none" stroke="#2b3122"/>` +
    `<rect x="1.5" y="1.5" width="${width - 3}" height="${BAND_HEIGHT - 3}" rx="9.5" fill="none" stroke="#fff7e7" stroke-opacity=".14"/>` +
    bandCassette(art, isPlaying ? seconds : null, now?.playlist || now?.album || 'good things take time ♡') +
    `<text x="${textLeft}" y="38" font-family="Georgia,'Times New Roman',serif" font-size="22" fill="${INK}">${escapeXml(clip(now ? now.name : 'Nothing playing', room))}</text>` +
    `<text x="${textLeft}" y="59" font-family="-apple-system,sans-serif" font-size="13" letter-spacing=".8" fill="${INK}" opacity=".8">${escapeXml(clip(now ? now.artist || now.album : 'Press play to start Music', Math.max(4, Math.floor(span / 7.8))))}</text>` +
    `<g transform="translate(${bar.left + span / 2 - 12} ${98 - 292})">${meter(0, pulse)}</g>` +
    (now
      ? `<text x="${bar.left}" y="97" font-family="-apple-system,sans-serif" font-size="11.5" letter-spacing=".6" fill="${INK}" opacity=".8">${clock(position)}</text>` +
        `<text x="${bar.right}" y="97" text-anchor="end" font-family="-apple-system,sans-serif" font-size="11.5" letter-spacing=".6" fill="${INK}" opacity=".8">${clock(now.duration)}</text>`
      : '') +
    `<rect x="${bar.left}" y="${bar.y}" width="${span}" height="4" rx="2" fill="#141a0d" opacity=".5"/>` +
    `<rect x="${bar.left}" y="${bar.y}" width="${(span * done).toFixed(1)}" height="4" rx="2" fill="${ACCENT}">${run}</rect>` +
    pet +
    keys +
    `</svg>`
  )
}
