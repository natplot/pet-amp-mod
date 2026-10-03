// The ClaudeAmp '98 skin: a dark metal player in the manner of an old desktop
// audio player, with a lit seven-segment clock, a spectrum and the ginger cat.
// It draws into the same shapes as the Tape Club skin (deck, key strip, band),
// so the pressable areas laid over them are the same.

import type { TapeNow } from '../types'

import {
  BAND_CAT,
  BAND_HEIGHT,
  DECK_WIDTH,
  PRESS_SECONDS,
  type DeckLayout,
  type Hit,
  type Pulse,
  type Scene,
  bandBar,
  bandSlots,
  clip,
  clock,
  escapeXml,
  into,
  pulseAt,
  standPet,
} from './art'
import { AMP } from './assets'

const C = {
  canvas: '#16171e',
  surface: '#242633',
  raised: '#414353',
  text: '#ebece8',
  muted: '#a9adbb',
  line: '#696c83',
  accent: '#f38a43',
  signal: '#c4ed89',
  inset: '#0d140c',
  ink: '#15170f',
}
const UI = "Tahoma,Verdana,sans-serif"
const MONO = "ui-monospace,Menlo,monospace"

// Seven segments of a 32 x 52 digit, a to g: top, upper right, lower right,
// bottom, lower left, upper left, middle.
const SEGMENTS = [
  '4,2 24,2 27,5 24,8 4,8 1,5',
  '25,8 28,5 31,8 31,23 28,26 25,23',
  '25,29 28,26 31,29 31,44 28,47 25,44',
  '4,44 24,44 27,47 24,50 4,50 1,47',
  '0,29 3,26 6,29 6,44 3,47 0,44',
  '0,8 3,5 6,8 6,23 3,26 0,23',
  '4,23 24,23 27,26 24,29 4,29 1,26',
]
const LIT = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg']
const isLit = (digit: number, segment: number) => LIT[digit]!.includes('abcdefg'[segment]!)

/**
 * One digit of the clock. Playing, each segment switches on and off by itself:
 * a digit that counts `per` seconds a step through `values` loops over
 * `per * values.length` seconds, so the clock runs with no redraw at all.
 */
function digit(x: number, y: number, s: number, values: number[], per: number, elapsed: number, isRunning: boolean) {
  const cycle = per * values.length
  const now = values[Math.floor((((elapsed % cycle) + cycle) % cycle) / per)]!
  const segments = SEGMENTS.map((points, i) => {
    const ghost = `<polygon points="${points}" fill="${C.signal}" opacity=".08"/>`
    const flips = isRunning
      ? `<animate attributeName="opacity" calcMode="discrete" values="${values.map(v => (isLit(v, i) ? 1 : 0)).join(';')}" dur="${cycle}s" ${into(cycle, elapsed)} repeatCount="indefinite"/>`
      : ''

    return `${ghost}<polygon points="${points}" fill="${C.signal}" stroke="${C.signal}" stroke-opacity=".3" stroke-width="3" stroke-linejoin="round" paint-order="stroke" opacity="${isLit(now, i) ? 1 : 0}">${flips}</polygon>`
  })

  return `<g transform="translate(${x} ${y}) scale(${s})">${segments.join('')}</g>`
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** MM:SS of `elapsed` seconds, 4 digits and a colon, 152 * s wide, leaning. */
function lcdClock(x: number, y: number, s: number, elapsed: number, isRunning: boolean) {
  const ten = range(10)

  return (
    `<g transform="translate(${x} ${y}) skewX(-7)">` +
    digit(0, 0, s, ten, 600, elapsed, isRunning) +
    digit(36 * s, 0, s, ten, 60, elapsed, isRunning) +
    `<g fill="${C.signal}"><rect x="${73 * s}" y="${15 * s}" width="${5 * s}" height="${5 * s}"/><rect x="${73 * s}" y="${33 * s}" width="${5 * s}" height="${5 * s}"/></g>` +
    digit(84 * s, 0, s, range(6), 10, elapsed, isRunning) +
    digit(120 * s, 0, s, ten, 1, elapsed, isRunning) +
    `</g>`
  )
}

// A steady hash, so the bars keep their shape from one redraw to the next.
const noise = (i: number) => {
  const v = Math.sin(i * 12.9898 + 4.1414) * 43758.5453

  return v - Math.floor(v)
}

/**
 * A spectrum of `n` bars that moves on the beat: low bars punch on every beat,
 * the middle on half beats, the top over two. Paused, it settles low.
 */
function spectrum(id: string, x: number, y: number, w: number, h: number, n: number, pulse: Pulse | null) {
  const gap = 2
  const bar = (w - (n - 1) * gap) / n
  const bars = range(n).map(i => {
    const share = i / (n - 1)
    // Bass louder than treble, with a few bumps so it reads as music.
    const level = Math.min(1, 0.95 - share * 0.45 + (noise(i) - 0.5) * 0.35)
    const top = (v: number) => y + h - Math.max(2, v * h)
    const left = x + i * (bar + gap)

    if (!pulse) {
      return `<rect x="${left.toFixed(1)}" y="${top(level * 0.12).toFixed(1)}" width="${bar.toFixed(1)}" height="${(y + h - top(level * 0.12)).toFixed(1)}"/>`
    }

    const beats = share < 0.3 ? 1 : share < 0.7 ? 0.5 : 2
    const cycle = pulse.period * beats
    const shape = [1, 0.35 + noise(i + 7) * 0.2, 0.7 + noise(i + 3) * 0.2, 0.3, 1].map(v => v * level)
    const loop = `keyTimes="0;0.2;0.5;0.8;1" dur="${cycle.toFixed(3)}s" ${into(cycle, pulse.sinceBar)} repeatCount="indefinite"`

    return (
      `<rect x="${left.toFixed(1)}" width="${bar.toFixed(1)}" y="${top(shape[0]!).toFixed(1)}" height="${(y + h - top(shape[0]!)).toFixed(1)}">` +
      `<animate attributeName="y" values="${shape.map(v => top(v).toFixed(1)).join(';')}" ${loop}/>` +
      `<animate attributeName="height" values="${shape.map(v => (y + h - top(v)).toFixed(1)).join(';')}" ${loop}/>` +
      `</rect>`
    )
  })

  return (
    `<defs>` +
    `<linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="0" y1="${y + h}" x2="0" y2="${y}"><stop offset="0" stop-color="#5fae35"/><stop offset=".45" stop-color="${C.signal}"/><stop offset=".75" stop-color="#f2d04e"/><stop offset="1" stop-color="${C.accent}"/></linearGradient>` +
    `<pattern id="${id}p" width="4" height="3" patternUnits="userSpaceOnUse" y="${y + h}"><rect y="2" width="4" height="1" fill="${C.inset}"/></pattern>` +
    `</defs>` +
    `<g fill="url(#${id}g)">${bars.join('')}</g>` +
    // dark rows across the bars turn them into lamps
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}p)"/>`
  )
}

/** The orange star of the title bars: six strokes through one point. */
const star = (x: number, y: number, r: number) =>
  `<g transform="translate(${x} ${y})" stroke="${C.accent}" stroke-width="${(r * 0.34).toFixed(2)}" stroke-linecap="round">${range(6)
    .map(i => {
      const dx = (Math.cos((i * Math.PI) / 6) * r).toFixed(2)
      const dy = (Math.sin((i * Math.PI) / 6) * r).toFixed(2)

      return `<path d="M-${dx} -${dy}L${dx} ${dy}"/>`
    })
    .join('')}</g>`

const picture = (name: keyof typeof AMP, x: number, y: number, w: number, h: number, extra = '') =>
  `<image href="${AMP[name]}" x="${x}" y="${y}" width="${w}" height="${h}"${extra}/>`

/** Brushed metal, tiled: the body of every window. */
const METAL = `<pattern id="metal" width="96" height="96" patternUnits="userSpaceOnUse"><image href="${AMP.metal}" width="96" height="96"/></pattern>`

/** A sunken panel: dark above and left, light below and right. */
const sunken = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>` +
  `<path d="M${x + 0.5} ${y + h}V${y + 0.5}H${x + w}" stroke="#07080b" fill="none"/>` +
  `<path d="M${x + 0.5} ${y + h - 0.5}H${x + w - 0.5}V${y + 0.5}" stroke="#9a9db0" stroke-opacity=".55" fill="none"/>`

/** The groove, its orange run and the thumb picture that rides it. */
function progress(x1: number, x2: number, y: number, now: TapeNow | null, position: number) {
  const span = x2 - x1
  const done = now && now.duration > 0 ? Math.min(1, position / now.duration) : 0
  const left = now ? Math.max(0, now.duration - position) : 0
  const isRunning = (now?.isPlaying ?? false) && left > 1
  const run = (from: number, to: number, attr: string) =>
    isRunning ? `<animate attributeName="${attr}" from="${from.toFixed(1)}" to="${to.toFixed(1)}" dur="${left.toFixed(1)}s" fill="freeze"/>` : ''

  return (
    sunken(x1, y - 2, span, 6, C.inset) +
    `<rect x="${x1 + 1}" y="${y - 1}" width="${(span * done).toFixed(1)}" height="4" fill="${C.accent}">${run(span * done, span, 'width')}</rect>` +
    `<image href="${AMP['slider-thumb']}" x="${(x1 + span * done - 6).toFixed(1)}" y="${y - 6}" width="12" height="14">${run(x1 + span * done - 6, x2 - 6, 'x')}</image>`
  )
}

const bpmLabel = (pulse: Pulse | null) => (pulse ? `${Math.round(60 / pulse.period)} BPM` : '— BPM')

/**
 * A transport key from the pictures. Pressed `age` seconds ago, it shows its
 * pressed picture until `PRESS_SECONDS` have passed, then its own again.
 */
function keyPicture(name: 'prev' | 'play' | 'pause' | 'next', x: number, y: number, age: number | null) {
  const up = picture(`btn-${name}`, x, y, 52, 44)

  if (age === null || age >= PRESS_SECONDS) {
    return up
  }

  const back = (PRESS_SECONDS - age).toFixed(3)

  return (
    `<g visibility="hidden">${up}<set attributeName="visibility" to="visible" begin="${back}s"/></g>` +
    `<g>${picture(`btn-${name}-down`, x, y, 52, 44)}<set attributeName="visibility" to="hidden" begin="${back}s"/></g>`
  )
}

/** The window's lower half: transport keys, volume, SHUFFLE and REPEAT. */
const KEYS_STRIP_HEIGHT = 56
// The volume track ends well short of the SHUFFLE/REPEAT box, and its thumb
// stays on the track at full volume.
const VOLUME = { x1: 248, x2: 288, y: 28, stops: [25, 60, 100] }
const THUMB = 12
const AMP_KEYS = [
  { name: 'prev', action: 'previous track' },
  { name: 'play', action: 'play' },
  { name: 'pause', action: 'pause' },
  { name: 'next', action: 'next track' },
] as const
const keyX = (i: number) => 8 + i * 54

// The window is taller than the cassette deck: room for the cat on its title bar.
const HEADROOM = 56
const DECK_HEIGHT_AMP = 220
const SEEK = { x1: 12, x2: 294, y: 208 }

/** Where ClaudeAmp's pressable parts are, for the blank Buttons laid over them. */
export const AMP_LAYOUT: DeckLayout = {
  height: DECK_HEIGHT_AMP,
  seek: SEEK,
  keysHeight: KEYS_STRIP_HEIGHT,
  keyHits: [
    ...AMP_KEYS.map((k, i): Hit => ({ x: keyX(i), y: 5, w: 52, h: 44, action: k.action })),
    ...VOLUME.stops.map((level, i): Hit => {
      const step = (VOLUME.x2 - VOLUME.x1) / VOLUME.stops.length

      return { x: VOLUME.x1 + i * step, y: 19, w: step, h: 18, action: `volume:${level}` }
    }),
    { x: 298, y: 5, w: 58, h: 22, action: 'shuffle' },
    { x: 298, y: 27, w: 58, h: 22, action: 'repeat' },
  ],
}

export function drawAmpDeck({ now, beat, at, position, pet }: Scene): string {
  const seconds = at / 1000
  const pulse = pulseAt(now, beat, seconds)
  const isPlaying = now?.isPlaying ?? false
  const title = now ? now.name : 'Nothing playing'
  const sub = now ? now.artist || now.album : 'Press play to start Music'
  const top = HEADROOM
  const lcd = { x: 8, y: top + 28, w: 344, h: 118 }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DECK_WIDTH}" height="${DECK_HEIGHT_AMP}" viewBox="0 0 ${DECK_WIDTH} ${DECK_HEIGHT_AMP}">` +
    `<defs>${METAL}</defs>` +
    // the window, open at the bottom: the key strip below closes it
    `<rect x="0" y="${top}" width="${DECK_WIDTH}" height="${DECK_HEIGHT_AMP - top}" fill="url(#metal)"/>` +
    `<path d="M.5 ${DECK_HEIGHT_AMP}V${top + 0.5}H${DECK_WIDTH - 0.5}V${DECK_HEIGHT_AMP}" stroke="#07080b" fill="none"/>` +
    `<path d="M1.5 ${DECK_HEIGHT_AMP}V${top + 1.5}H${DECK_WIDTH - 1.5}" stroke="#c9ccdb" stroke-opacity=".35" fill="none"/>` +
    picture('titlebar', 1, top + 1, DECK_WIDTH - 2, 22) +
    star(13, top + 12, 5) +
    `<text x="25" y="${top + 16}" font-family="${UI}" font-size="10.5" font-weight="bold" letter-spacing="1.5" fill="${C.text}">PLAYER</text>` +
    picture('btn-min', 316, top + 4, 18, 16) +
    picture('btn-close', 336, top + 4, 18, 16) +
    // the display: clock, state, title, tempo, spectrum, then the glass over it all
    sunken(lcd.x, lcd.y, lcd.w, lcd.h, C.inset) +
    lcdClock(20, lcd.y + 11, 0.62, position, isPlaying) +
    (isPlaying
      ? `<path d="M${lcd.x + 112} ${lcd.y + 15}l13 8l-13 8z" fill="${C.signal}"/>`
      : `<path d="M${lcd.x + 112} ${lcd.y + 15}h4v16h-4zM${lcd.x + 120} ${lcd.y + 15}h4v16h-4z" fill="${C.signal}"/>`) +
    `<text x="${lcd.x + 132}" y="${lcd.y + 25}" font-family="${UI}" font-size="13.5" fill="${C.signal}">${escapeXml(clip(title, 20))}</text>` +
    `<text x="${lcd.x + 132}" y="${lcd.y + 42}" font-family="${UI}" font-size="11" fill="${C.muted}">${escapeXml(clip(sub, 26))}</text>` +
    `<text x="${lcd.x + lcd.w - 9}" y="${lcd.y + 17}" text-anchor="end" font-family="${MONO}" font-size="7.5" letter-spacing=".8" fill="${C.signal}">${bpmLabel(pulse)}</text>` +
    `<text x="${lcd.x + lcd.w - 9}" y="${lcd.y + 28}" text-anchor="end" font-family="${MONO}" font-size="7.5" letter-spacing=".8" fill="${C.signal}" opacity=".7">STEREO</text>` +
    spectrum('ds', lcd.x + 8, lcd.y + 54, lcd.w - 16, 56, 34, pulse) +
    picture('lcd-glass', lcd.x, lcd.y, lcd.w, lcd.h) +
    // seek bar, and the track's length in a small display of its own
    progress(SEEK.x1, SEEK.x2, SEEK.y, now, position) +
    sunken(300, SEEK.y - 9, 52, 18, C.inset) +
    (now ? `<text x="346" y="${SEEK.y + 4}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.signal}">${clock(now.duration)}</text>` : '') +
    // the cat sits on the window's title bar, left of its buttons
    (pet ? standPet(pet, pulse, 252, top + 1, 50) : '') +
    `</svg>`
  )
}

export function drawAmpKeys(now: TapeNow | null, pressed?: { slot: number; age: number }): string {
  const volume = now?.volume ?? 50
  const span = VOLUME.x2 - VOLUME.x1
  const toggle = (on: boolean, y: number, label: string) =>
    picture(on ? 'toggle-on' : 'toggle-off', 302, y, 14, 14) +
    `<text x="319" y="${y + 9.6}" font-family="${UI}" font-size="5.6" font-weight="bold" letter-spacing=".25" fill="${C.text}">${label}</text>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DECK_WIDTH}" height="${KEYS_STRIP_HEIGHT}" viewBox="0 0 ${DECK_WIDTH} ${KEYS_STRIP_HEIGHT}">` +
    `<defs>${METAL}</defs>` +
    `<rect width="${DECK_WIDTH}" height="${KEYS_STRIP_HEIGHT}" fill="url(#metal)"/>` +
    `<path d="M.5 0V${KEYS_STRIP_HEIGHT - 0.5}H${DECK_WIDTH - 0.5}V0" stroke="#07080b" fill="none"/>` +
    `<path d="M1.5 0V${KEYS_STRIP_HEIGHT - 1.5}" stroke="#c9ccdb" stroke-opacity=".35"/>` +
    AMP_KEYS.map((k, i) => keyPicture(k.name, keyX(i), 5, pressed && pressed.slot === i ? pressed.age : null)).join('') +
    picture('speaker', 226, 20, 18, 16) +
    sunken(VOLUME.x1, VOLUME.y - 2, span, 6, C.inset) +
    `<rect x="${VOLUME.x1 + 1}" y="${VOLUME.y - 1}" width="${(((span - THUMB) * volume) / 100 + THUMB / 2).toFixed(1)}" height="4" fill="${C.accent}"/>` +
    picture('slider-thumb', VOLUME.x1 + ((span - THUMB) * volume) / 100, VOLUME.y - 6, THUMB, 14) +
    sunken(298, 5, 56, 44, '#1b1d27') +
    toggle(now?.shuffle ?? false, 9, 'SHUFFLE') +
    toggle((now?.repeat ?? 'off') !== 'off', 30, 'REPEAT') +
    `</svg>`
  )
}

/** The deck key of the band, drawn in the manner of the pictured keys: an eject mark. */
function ejectKey(x: number, y: number, w: number, h: number) {
  const mid = x + w / 2
  const centre = y + h / 2

  return (
    `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="1.5" fill="url(#ampKey)" stroke="#30333f" stroke-width="1.5"/>` +
    `<path d="M${x + 3} ${y + h - 3}V${y + 3}H${x + w - 3}" stroke="#fff" stroke-opacity=".75" fill="none"/>` +
    `<path d="M${x + 3} ${y + h - 3}H${x + w - 3}V${y + 3}" stroke="#4a4d5c" fill="none"/>` +
    `<path d="M${mid - 9} ${centre + 1}l9 -10l9 10zM${mid - 9} ${centre + 4}h18v4h-18z" fill="${C.ink}"/>`
  )
}

export function drawAmpBand({ now, beat, at, position, pet }: Scene, width: number, pressed?: { slot: number; age: number }): string {
  const seconds = at / 1000
  const pulse = pulseAt(now, beat, seconds)
  const isPlaying = now?.isPlaying ?? false
  const slots = bandSlots(width)
  const bar = bandBar(width, pet)
  const span = bar.right - bar.left
  const top = (BAND_HEIGHT - 44) / 2
  const names = ['prev', isPlaying ? 'pause' : 'play', 'next'] as const
  const keys = slots.map((slot, i) => {
    const age = pressed && pressed.slot === slot.slot ? pressed.age : null
    const x = slot.x + (slot.width - 52) / 2

    return slot.command === 'deck' ? ejectKey(x, top, 52, 44) : keyPicture(names[i]!, x, top, age)
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAND_HEIGHT}" viewBox="0 0 ${width} ${BAND_HEIGHT}">` +
    `<defs>${METAL}<linearGradient id="ampKey" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4d6e0"/><stop offset="1" stop-color="#8b8ea0"/></linearGradient></defs>` +
    `<rect width="${width}" height="${BAND_HEIGHT}" rx="2" fill="url(#metal)"/>` +
    `<rect x=".5" y=".5" width="${width - 1}" height="${BAND_HEIGHT - 1}" rx="2" fill="none" stroke="#07080b"/>` +
    `<path d="M1.5 ${BAND_HEIGHT - 2}V1.5H${width - 2}" stroke="#c9ccdb" stroke-opacity=".35" fill="none"/>` +
    // the lit display, where the deck's cassette sits in the other skin
    sunken(7, 6, 168, 101, C.inset) +
    lcdClock(17, 15, 0.64, position, isPlaying) +
    (isPlaying
      ? `<path d="M140 20l12 7.5l-12 7.5z" fill="${C.signal}"/>`
      : `<path d="M140 20h4v15h-4zM148 20h4v15h-4z" fill="${C.signal}"/>`) +
    `<text x="16" y="62" font-family="${MONO}" font-size="8" letter-spacing=".8" fill="${C.signal}">${bpmLabel(pulse)}</text>` +
    `<text x="166" y="62" text-anchor="end" font-family="${MONO}" font-size="8" letter-spacing=".8" fill="${C.signal}" opacity=".7">STEREO</text>` +
    spectrum('bs', 16, 68, 150, 32, 18, pulse) +
    picture('lcd-glass', 7, 6, 168, 101, ' preserveAspectRatio="none"') +
    `<text x="${bar.left}" y="38" font-family="${UI}" font-size="19" fill="${C.text}">${escapeXml(clip(now ? now.name : 'Nothing playing', Math.max(4, Math.floor(span / 10.5))))}</text>` +
    `<text x="${bar.left}" y="59" font-family="${UI}" font-size="12.5" fill="${C.muted}">${escapeXml(clip(now ? now.artist || now.album : 'Press play to start Music', Math.max(4, Math.floor(span / 7.2))))}</text>` +
    progress(bar.left, bar.right, bar.y, now, position) +
    `<text x="${bar.left}" y="97" font-family="${MONO}" font-size="8" letter-spacing="1.2" fill="${C.muted}">CLAUDEAMP '98</text>` +
    (now ? `<text x="${bar.right}" y="97" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.signal}">${clock(now.duration)}</text>` : '') +
    (pet ? standPet(pet, pulse, bar.right + 10, BAND_HEIGHT - BAND_CAT.margin, BAND_CAT.height) : '') +
    keys.join('') +
    `</svg>`
  )
}
