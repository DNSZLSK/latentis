/** The four bins of Latent Data Refinement. */
export type BinCode = 'HL' | 'SY' | 'RP' | 'OC'

/** One file (a quota of suspect tokens), spanning as many turns as it takes. */
export type FileState = {
  batch: number
  name: string
  seed: number
  /** Tokens refined per bin; the file is complete when every bin reaches `quota`. */
  binned: Record<BinCode, number>
  quota: number
}

/** What the hooks module hands the board (the `Client`'s props). */
export type BoardProps = {
  file: FileState | null
  /** The board takes input (always, once a file is assigned). */
  active: boolean
  /** The agent is not working: the refiner is on unpaid overtime. */
  overtime: boolean
  party: boolean
  /**
   * False on the terminal's main screen, where no click reaches the board:
   * it draws a static board and says fullscreen is required.
   */
  playable: boolean
  /** The region the pane gives the board, in cells. */
  columns: number
  rows: number
}

/** What the board posts back to the hooks module. */
export type BoardPost = { kind: 'binned'; bin: BinCode; count: number }

declare module 'claude-code' {
  interface PluginState {
    latentis: {
      file: Shaped<FileState | null>
      active: boolean
      party: boolean
      maxim: string
      dismissed: boolean
    }
  }
}
