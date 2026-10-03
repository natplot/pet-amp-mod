export type TapeTrack = { index: number; name: string; time: string }

export type TapeNow = {
  isPlaying: boolean
  name: string
  artist: string
  album: string
  /** Seconds. */
  duration: number
  /** Seconds into the track when it was sampled, at clock time `at` (ms). */
  position: number
  at: number
  /** 0 when the track carries no tempo. */
  bpm: number
  /** Music's own volume, 0-100. */
  volume: number
  shuffle: boolean
  /** `off`, `one` or `all`. */
  repeat: string
  playlist: string
  index: number
  /** The current track and its neighbours in the playlist. */
  tracks: TapeTrack[]
}

/** Which drawn key was pressed (its slot), at clock time `at` (ms). */
export type TapePress = { slot: number; at: number }

/** The beat Mac Pulse hears: its tempo, the clock time (ms) of one beat, and of
 *  a beat that opens a bar of four, kept in step from one reading to the next. */
export type TapeBeat = { bpm: number; beatAt: number; barAt: number }

/** Which look the deck and the band wear. */
export type TapeSkin = 'tape' | 'amp'

/** The pet chosen in the pane: one by name, none, or the skin's own. */
export type TapePetChoice = 'skin' | 'calico' | 'ginger' | 'cavapoo' | 'none'

export type TapeArt = 'raster' | 'vector'

declare module 'claude-code' {
  interface PluginState {
    'tape-club': { isOn: boolean; skin: TapeSkin; petChoice: TapePetChoice; now: TapeNow | null; art: TapeArt; hasPet: boolean; hasKeys: boolean; pressed: TapePress | null; beat: TapeBeat | null }
  }
}
