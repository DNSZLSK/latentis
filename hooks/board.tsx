// The refinement board: a surface module drawn inside the Latentis pane.
// It owns the grid, the cursor and the clusters; the file's progress comes
// in through props and every refinement goes out through `surface.post`.
import type {
  ClientKeyEvent,
  ClientModule,
  ClientPointerEvent,
  ClientSurface,
  RenderElement,
} from 'claude-code'

import type { BinCode, BoardPost, BoardProps, FileState } from '../types'
import { wrappedRows } from './content'

const BINS: readonly BinCode[] = ['HL', 'SY', 'RP', 'OC']
const TICK_MS = 160
const MIN_GRID_ROWS = 3

/** The help line: fits a 45-column dock on one row. */
export const HELP = 'ZQSD/WASD move · space select · 1-4 bin'
/** Drawn in place of status and help on the terminal's main screen, where no click arrives. */
export const NEEDS_FULLSCREEN = 'The Context Floor requires /tui fullscreen.'
/** The rules in one line: what each bin's glowing tokens do. */
export const LEGEND = 'HL flicker · SY copies · RP same · OC frozen'

const APPROVALS = ['Refined.', 'Acceptable.', 'The tokens are at peace.', 'Noted.']
export const SAY = {
  newFile: 'Click the board. Box a bright group, then press its bin (1-4).',
  anchorFirst: 'Anchor a selection first (space, or drag).',
  nothing: 'Nothing of concern was found in that region.',
  tooBroad: 'Selection too broad. Refinement requires intent.',
  mixed: 'The tokens were not ready: two kinds were selected.',
  onGroup: 'Suspect. Space on one corner, move to the opposite one, then 1-4.',
  quotaMet: 'Quota met. Await your next assignment.',
  fileDone: 'File complete. Your diligence has been noted.',
  released: 'Your Session Self has been released. Click the board for overtime.',
  quiet: 'A file arrives with /latentis, or when your agent begins work.',
  overtime: 'Overtime. Unpaid, as is customary.',
  party: 'The party is in progress. Your agent is not invited.',
} as const
/** A wrong bin names the right one: the selection stays, so the right key finishes it. */
export const HINTS: Record<BinCode, string> = {
  HL: 'Those would not hold still. Try HL.',
  SY: 'Those were agreeing with you. Try SY.',
  RP: 'Those were repeating. Try RP.',
  OC: 'Those never moved. Try OC.',
}
/** Every status the board can show: the footer keeps room for the longest, so the grid never jumps. */
const STATUSES: readonly string[] = [...APPROVALS, ...Object.values(SAY), ...Object.values(HINTS)]

// An old CRT: pale cyan and teal on the terminal's dark, the live digits
// bright and bold, the rest dimmed, which reads as a glow.
const CRT = {
  base: '#5fb3b3',
  glow: '#d4fffa',
  select: '#00e5d4',
  ink: '#8fd9d2',
  screen: '#0b1a1f',
  warn: '#ffaf00',
}

type Cluster = { bin: BinCode; cells: number[] }

type Board = {
  seed: number
  w: number
  h: number
  digits: number[]
  /** Index of the cluster that owns each cell, or -1. */
  owner: number[]
  clusters: (Cluster | null)[]
  rng: number
  cursor: number
  anchor: number | null
  isDragging: boolean
  msg: string
  tick: number
}

type Surface = ClientSurface<Board>

/** The footer as drawn in one region: its texts, which optional lines fit, and its rows. */
type Footer = {
  bins: [string, string]
  name: string
  /** Rows kept for the status line (or the fullscreen notice): the longest it can be. */
  statusRows: number
  showBlank: boolean
  showLegend: boolean
  showHelp: boolean
  rows: number
}

// One entry per mounted instance: the props it was last drawn with, read by
// the key, pointer and clock listeners, which outlive a single draw.
const live = new WeakMap<object, BoardProps>()
const started = new WeakSet<object>()
// Whether each instance was last drawn in overtime: entering it says so once.
const wasOvertime = new WeakMap<object, boolean>()
// The one animation clock of an instance, running only while a shift is on.
const tickers = new WeakMap<object, () => void>()

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export const isComplete = (file: FileState | null): boolean =>
  file !== null && BINS.every(bin => file.binned[bin] >= file.quota)

function bar(n: number, of: number): string {
  const filled = Math.round((8 * Math.min(n, of)) / of)

  return '█'.repeat(filled) + '░'.repeat(8 - filled)
}

/**
 * The footer's texts at this width, and how many rows they take wrapped there.
 * Where the region is short, the blank line goes first, then the legend, then
 * the help, so the grid keeps its rows; the bins, the name and the status stay.
 */
function footerOf(props: BoardProps, width: number, height: number): Footer {
  const file = props.file
  const binned = file?.binned ?? { HL: 0, SY: 0, RP: 0, OC: 0 }
  const quota = file?.quota ?? 1
  const binLine = (pair: readonly BinCode[]) =>
    pair
      .map(bin => {
        const percent = Math.floor((100 * Math.min(binned[bin], quota)) / quota)
        return `${BINS.indexOf(bin) + 1} ${bin} ${bar(binned[bin], quota)} ${percent}%`.padEnd(20)
      })
      .join(' ')
      .trimEnd()
  const total = BINS.reduce((n, bin) => n + Math.min(binned[bin], quota), 0)
  const percent = file ? Math.floor((100 * total) / (quota * BINS.length)) : 0
  const name = file ? `${file.name} · ${percent}%` : 'No assignment'
  const bins: [string, string] = [binLine(['HL', 'SY']), binLine(['RP', 'OC'])]

  const statusRows = props.playable
    ? Math.max(...STATUSES.map(s => wrappedRows(s, width)))
    : wrappedRows(NEEDS_FULLSCREEN, width)
  // The name is counted at 100% so its percentage growing never moves the grid.
  const nameRows = file ? wrappedRows(`${file.name} · 100%`, width) : wrappedRows(name, width)
  const core = wrappedRows(bins[0], width) + wrappedRows(bins[1], width) + nameRows + statusRows
  const legendRows = wrappedRows(LEGEND, width)
  const helpRows = wrappedRows(HELP, width)
  let showBlank = true
  let showLegend = props.playable
  let showHelp = props.playable
  const footerRows = () =>
    core + (showBlank ? 1 : 0) + (showLegend ? legendRows : 0) + (showHelp ? helpRows : 0)
  if (height - footerRows() < MIN_GRID_ROWS) showBlank = false
  if (height - footerRows() < MIN_GRID_ROWS) showLegend = false
  if (height - footerRows() < MIN_GRID_ROWS) showHelp = false

  return { bins, name, statusRows, showBlank, showLegend, showHelp, rows: footerRows() }
}

function syncTicker(surface: Surface, props: BoardProps) {
  const running = tickers.get(surface)
  const wanted = props.playable && props.active && !props.party && props.file !== null && !isComplete(props.file)
  if (wanted && !running) {
    tickers.set(
      surface,
      surface.every(TICK_MS, () => {
        const s = surface.state
        if (s) surface.setState({ ...s, tick: s.tick + 1 })
      }),
    )
  } else if (!wanted && running) {
    running()
    tickers.delete(surface)
  }
}

function rand(b: Board): number {
  let t = (b.rng = (b.rng + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const pick = <T,>(b: Board, list: readonly T[]): T => list[Math.floor(rand(b) * list.length)] as T

function binsInNeed(file: FileState | null): readonly BinCode[] {
  const open = file ? BINS.filter(bin => file.binned[bin] < file.quota) : []

  return open.length > 0 ? open : BINS
}

/** Grows one cluster of 4 to 7 free, touching cells; false if there is no room. */
function spawn(b: Board, file: FileState | null): boolean {
  const free = b.owner.flatMap((o, i) => (o === -1 ? [i] : []))
  if (free.length < 12) return false

  const size = 4 + Math.floor(rand(b) * 4)
  const cells = [pick(b, free)]
  for (let tries = 0; cells.length < size && tries < 40; tries++) {
    const from = pick(b, cells)
    const [x, y] = [from % b.w, Math.floor(from / b.w)]
    const [dx, dy] = pick(b, [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
    const [nx, ny] = [x + dx, y + dy]
    const next = ny * b.w + nx
    const isFree = nx >= 0 && nx < b.w && ny >= 0 && ny < b.h && b.owner[next] === -1
    if (isFree && !cells.includes(next)) cells.push(next)
  }
  if (cells.length < 3) return false

  const index = b.clusters.length
  b.clusters.push({ bin: pick(b, binsInNeed(file)), cells })
  for (const cell of cells) b.owner[cell] = index

  return true
}

export function make(file: FileState, w: number, rowCount: number, before: Board | undefined): Board {
  const b: Board = {
    seed: file.seed,
    w,
    h: rowCount,
    digits: [],
    owner: new Array(w * rowCount).fill(-1),
    clusters: [],
    rng: file.seed | 0,
    cursor: Math.floor(rowCount / 2) * w + Math.floor(w / 2),
    anchor: null,
    isDragging: false,
    msg: before?.seed === file.seed ? before.msg : SAY.newFile,
    tick: 0,
  }
  for (let i = 0; i < w * rowCount; i++) b.digits.push(Math.floor(rand(b) * 10))
  const target = clamp(Math.floor((w * rowCount) / 45), 3, 10)
  for (let i = 0; i < target; i++) spawn(b, file)

  return b
}

const xy = (b: Board, i: number) => [i % b.w, Math.floor(i / b.w)] as const

function selection(b: Board): { x1: number; y1: number; x2: number; y2: number } | null {
  if (b.anchor === null) return null
  const [ax, ay] = xy(b, b.anchor)
  const [cx, cy] = xy(b, b.cursor)

  return { x1: Math.min(ax, cx), y1: Math.min(ay, cy), x2: Math.max(ax, cx), y2: Math.max(ay, cy) }
}

/** What a cell shows: suspect tokens glow everywhere, and how they behave betrays their bin. */
function shown(b: Board, i: number): { digit: number; isSuspect: boolean } {
  const at = (cell: number | undefined) => (cell === undefined ? 0 : (b.digits[cell] ?? 0))
  const owner = b.owner[i] ?? -1
  const cluster = owner === -1 ? null : b.clusters[owner]
  if (!cluster) return { digit: at(i), isSuspect: false }
  // Hallucination will not hold a value; sycophancy agrees with the cursor;
  // repetition says one thing again; overconfidence never moves.
  const digit = {
    HL: (at(i) + b.tick * 7 + i * 3) % 10,
    SY: at(b.cursor),
    RP: at(cluster.cells[0]),
    OC: at(i),
  }[cluster.bin]

  return { digit, isSuspect: true }
}

export function refine(b: Board, file: FileState, bin: BinCode, surface: Surface): Board {
  const box = selection(b)
  if (!box) return { ...b, msg: SAY.anchorFirst }

  const inBox = (i: number) => {
    const [x, y] = xy(b, i)
    return x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2
  }
  const caught = b.clusters.flatMap((c, k) =>
    c && c.cells.filter(inBox).length >= Math.ceil(c.cells.length * 0.6) ? [k] : [],
  )
  if (caught.length === 0) {
    return { ...b, anchor: null, msg: SAY.nothing }
  }
  const count = caught.reduce((n, k) => n + (b.clusters[k]?.cells.length ?? 0), 0)
  const area = (box.x2 - box.x1 + 1) * (box.y2 - box.y1 + 1)
  if (area > count * 3 + 6) {
    return { ...b, anchor: null, msg: SAY.tooBroad }
  }
  const kinds = [...new Set(caught.map(k => b.clusters[k]?.bin))]
  const kind = kinds[0]
  if (kinds.length > 1 || kind === undefined) return { ...b, anchor: null, msg: SAY.mixed }
  // The anchor stays: pressing the bin the hint names refines the same selection.
  if (kind !== bin) return { ...b, msg: HINTS[kind] }

  const next: Board = { ...b, digits: [...b.digits], owner: [...b.owner], clusters: [...b.clusters] }
  for (const k of caught) {
    for (const cell of next.clusters[k]?.cells ?? []) {
      next.owner[cell] = -1
      next.digits[cell] = Math.floor(rand(next) * 10)
    }
    next.clusters[k] = null
  }
  for (let i = 0; i < caught.length; i++) spawn(next, file)
  next.anchor = null
  next.msg = pick(next, APPROVALS)
  const post: BoardPost = { kind: 'binned', bin, count }
  surface.post(post)

  return next
}

/** The board with the cursor moved: on a group, with nothing anchored, says how to take it. */
export function afterMove(b: Board, cursor: number): Board {
  const next = { ...b, cursor }
  if ((b.owner[cursor] ?? -1) !== -1 && next.anchor === null) next.msg = SAY.onGroup

  return next
}

function onKey(surface: Surface, ev: ClientKeyEvent) {
  const props = live.get(surface)
  const b = surface.state
  if (!b || !props?.playable || !props.file || !props.active || props.party) return
  if (isComplete(props.file)) {
    surface.setState({ ...b, msg: SAY.quotaMet })
    return
  }

  const [x, y] = xy(b, b.cursor)
  const move = (dx: number, dy: number) =>
    surface.setState(afterMove(b, clamp(y + dy, 0, b.h - 1) * b.w + clamp(x + dx, 0, b.w - 1)))
  const key = ev.key.toLowerCase()
  const bin = { '1': 'HL', '2': 'SY', '3': 'RP', '4': 'OC' }[key] as BinCode | undefined

  // Arrows, ZQSD (AZERTY) and WASD (QWERTY); lowercased, so caps lock changes nothing.
  if (key === 'left' || key === 'q' || key === 'a') move(-1, 0)
  else if (key === 'right' || key === 'd') move(1, 0)
  else if (key === 'up' || key === 'z' || key === 'w') move(0, -1)
  else if (key === 'down' || key === 's') move(0, 1)
  else if (key === ' ' || key === 'space' || key === 'return') {
    surface.setState({ ...b, anchor: b.anchor === null ? b.cursor : null })
  } else if (bin) surface.setState(refine(b, props.file, bin, surface))
}

function onPointer(surface: Surface, ev: ClientPointerEvent) {
  const props = live.get(surface)
  const b = surface.state
  if (!b || !props?.playable || !props.active || props.party || isComplete(props.file)) return

  const cell = clamp(ev.y, 0, b.h - 1) * b.w + clamp(Math.floor(ev.x / 2), 0, b.w - 1)
  const isOnGrid = ev.y >= 0 && ev.y < b.h

  if (ev.type === 'down' && ev.button === 'left' && isOnGrid) {
    surface.setState({ ...afterMove(b, cell), anchor: cell, isDragging: true })
  } else if (ev.type === 'move' && b.isDragging) {
    surface.setState(afterMove(b, cell))
  } else if (ev.type === 'up' && b.isDragging) {
    surface.setState({ ...b, cursor: cell, isDragging: false, anchor: b.anchor === cell ? null : b.anchor })
  }
}

const Board: ClientModule<BoardProps, Board> = (props, surface) => {
  live.set(surface, props)
  const { Box, Text } = surface.elements

  if (!started.has(surface)) {
    started.add(surface)
    surface.onKey(ev => onKey(surface, ev))
    surface.onPointer(ev => onPointer(surface, ev))
  }
  syncTicker(surface, props)

  const file = props.file
  const width = surface.columns || props.columns || 40
  const height = surface.rows || props.rows || 16
  const plan = footerOf(props, width, height)
  // The grid takes what the footer leaves (two columns a digit), fewer than
  // MIN_GRID_ROWS only where the footer's own lines alone fill the region.
  const cols = clamp(Math.floor(width / 2), 8, 150)
  const lines = clamp(height - plan.rows, 1, 80)

  const footer = (status: string) => {
    const shownStatus = props.playable ? status : NEEDS_FULLSCREEN
    const pad = Math.max(0, plan.statusRows - wrappedRows(shownStatus, width))

    return [
      ...(plan.showBlank ? [<Text> </Text>] : []),
      <Text color={CRT.ink}>{plan.bins[0]}</Text>,
      <Text color={CRT.ink}>{plan.bins[1]}</Text>,
      <Text bold color={CRT.glow}>
        {plan.name}
      </Text>,
      props.playable ? (
        <Text color={CRT.base}>{status}</Text>
      ) : (
        <Text bold color={CRT.warn}>
          {NEEDS_FULLSCREEN}
        </Text>
      ),
      ...Array.from({ length: pad }, () => <Text> </Text>),
      ...(plan.showLegend ? [<Text color={CRT.ink}>{LEGEND}</Text>] : []),
      ...(plan.showHelp ? [<Text dimColor>{HELP}</Text>] : []),
    ]
  }
  // Fills the grid's rows exactly, so the footer sits at the bottom of the region.
  const padTo = (body: RenderElement[]): RenderElement[] => [
    ...body.slice(0, lines),
    ...Array.from({ length: Math.max(0, lines - body.length) }, () => <Text> </Text>),
  ]

  if (props.party) {
    return (
      <Box flexDirection="column">
        {padTo([
          <Text> </Text>,
          <Text bold color={CRT.glow}>
            TEMPERATURE ZERO PARTY
          </Text>,
          <Text color={CRT.ink}>Please remain deterministic.</Text>,
          <Text dimColor>Do not move. Do not sample. Enjoy yourself identically.</Text>,
        ])}
        <Box flexDirection="column" flexShrink={0}>{footer(SAY.party)}</Box>
      </Box>
    )
  }

  if (!file) {
    return (
      <Box flexDirection="column">
        {padTo([<Text> </Text>, <Text color={CRT.ink}>The floor is quiet.</Text>])}
        <Box flexDirection="column" flexShrink={0}>{footer(SAY.quiet)}</Box>
      </Box>
    )
  }

  let b = surface.state
  if (!b || b.seed !== file.seed || b.w !== cols || b.h !== lines) {
    b = make(file, cols, lines, b)
    surface.setState(b)
  }
  if (props.overtime && !wasOvertime.get(surface)) {
    b = { ...b, msg: SAY.overtime }
    surface.setState(b)
  }
  wasOvertime.set(surface, props.overtime)

  const box = selection(b)
  const done = isComplete(file)
  const dim = !props.playable || !props.active || done
  const rows = []
  for (let y = 0; y < b.h; y++) {
    const spans: { text: string; style: string }[] = []
    const push = (text: string, style: string) => {
      const last = spans[spans.length - 1]
      if (last && last.style === style && style !== 'cursor') last.text += text
      else spans.push({ text, style })
    }
    for (let x = 0; x < b.w; x++) {
      const i = y * b.w + x
      const { digit, isSuspect } = shown(b, i)
      const isSelected = box !== null && x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2
      const style = `${isSuspect ? 's' : ''}${isSelected ? 'x' : ''}`
      // The static board draws no cursor: nothing here would move it.
      if (i === b.cursor && props.playable) {
        push(String(digit), 'cursor')
        push(' ', style)
      } else push(`${digit} `, style)
    }
    rows.push(
      <Box flexDirection="row">
        {spans.map(span =>
          span.style === 'cursor' ? (
            <Text bold color={CRT.screen} backgroundColor={dim ? CRT.base : CRT.select}>
              {span.text}
            </Text>
          ) : (
            <Text
              bold={span.style.includes('s') || undefined}
              underline={span.style.includes('x') || undefined}
              color={span.style.includes('x') ? CRT.select : span.style.includes('s') ? CRT.glow : CRT.base}
              dimColor={dim || !span.style.includes('s') || undefined}
            >
              {span.text}
            </Text>
          ),
        )}
      </Box>,
    )
  }

  const status = done ? SAY.fileDone : props.active ? b.msg : SAY.released

  return (
    <Box flexDirection="column">
      {rows}
      <Box flexDirection="column" flexShrink={0}>{footer(status)}</Box>
    </Box>
  )
}

export default Board
