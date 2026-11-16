import { expect, test } from 'claude-code/testing'

import type { FileState } from '../types'
import { HELP, HINTS, LEGEND, NEEDS_FULLSCREEN, SAY, afterMove, make, refine } from './board'
import { wrappedRows } from './content'
import { branchOf, clean } from './register'

type Git = { kind: 'dir' | 'file' | 'none'; head?: string }

/** Stands for the engine: an in-memory store, a repo at /work/latentis, a .git. */
function engine(on: any, git: Git = { kind: 'dir', head: 'ref: refs/heads/main\n' }) {
  const store: Record<string, unknown> = {}
  const calls = { open: 0, headReads: 0, otherReads: [] as string[], opens: [] as Record<string, unknown>[] }

  on('store.get', (_: unknown, e: { key: string }) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/work/latentis' }))
  on('fs.stat', (_: unknown, e: { path: string }) => {
    if (git.kind === 'none') throw new Error('ENOENT')
    return { value: { kind: git.kind, size: 0, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (e.path === '.git/HEAD') calls.headReads += 1
    else calls.otherReads.push(e.path)
    return { value: git.head ?? '' }
  })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', (_: unknown, e: Record<string, unknown>) => {
    calls.open += 1
    calls.opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  return { store, calls }
}

const start = ($: any) => $.session.start({ cwd: '/work/latentis', surface: 'terminal', isInteractive: true })
const turn = ($: any, id: string, agentId?: string) => $.turn.start({ text: 'go', turnId: id, ...(agentId ? { agentId } : {}) })
const done = ($: any, id: string, agentId?: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: id, reason: 'answer', ...(agentId ? { agentId } : {}) })
const run = ($: any, args: string, isFullscreen?: boolean) =>
  $.command.run({ command: 'latentis', args, ...(isFullscreen === undefined ? {} : { presentation: { isFullscreen, columns: 120 } }) })

const FULL = { columns: 160, rows: 48, isFullscreen: true }
const MAIN = { columns: 160, rows: 48, isFullscreen: false }

const PANE = {
  plugin: 'latentis',
  component: 'Pane',
  requestId: 'latentis',
  props: {
    title: 'Latentis',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** The file as the mod last saved it. */
const fileIn = (store: Record<string, unknown>): FileState | null =>
  ((store.file as { value?: FileState } | undefined)?.value ?? null)

/** Whether the board shows the floor released (no shift running). */
async function isReleased($: any): Promise<boolean> {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const found = await ui.find({ type: 'Text', text: /has been released/, in: 'board' })
  await ui.unmount()
  return found !== undefined
}

test('a main-loop turn activates the floor, its end releases it', async ($, on) => {
  engine(on)
  await start($)
  await turn($, 't1')
  expect(await isReleased($)).toBe(false)
  await done($, 't1')
  expect(await isReleased($)).toBe(true)
})

test('a subagent turn neither activates the floor nor opens a file', async ($, on) => {
  const { store } = engine(on)
  await start($)
  await turn($, 's1', 'agent-7')
  expect(fileIn(store)).toBe(null)
  expect(store.batchCounter).toBe(undefined)

  // With a file on the floor and the shift over, a subagent does not start one.
  await turn($, 't1')
  await done($, 't1')
  await turn($, 's2', 'agent-7')
  expect(await isReleased($)).toBe(true)
  await done($, 's2', 'agent-7')
  expect(store.batchCounter).toBe(1)
})

test('an unfinished file resumes on the next turn with its progress', async ($, on) => {
  const { store } = engine(on)
  await start($)
  await turn($, 't1')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.post({ kind: 'binned', bin: 'HL', count: 5 }, { in: 'board' })
    await ui.unmount()
  }
  const before = fileIn(store)
  expect(before?.binned.HL).toBe(10)
  await done($, 't1')

  await turn($, 't2')
  const after = fileIn(store)
  expect(after).toEqual(before)
  expect(store.batchCounter).toBe(1)
})

test('a completed file awards commendations; the next file is a new batch and seed', async ($, on) => {
  const { store } = engine(on)
  await start($)
  await turn($, 't1')
  const first = fileIn(store)
  expect(first?.name).toBe('latentis · main · Batch 0001')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const bin of ['HL', 'SY', 'RP', 'OC']) {
    for (let n = 0; n < 4; n++) await ui.post({ kind: 'binned', bin, count: 5 }, { in: 'board' })
  }
  await ui.unmount()
  expect((store.stats as any).files).toBe(1)
  expect((store.stats as any).tokens).toBe(80)
  expect((store.stats as any).badges).toEqual(['Certified Grounded'])

  await done($, 't1')
  await turn($, 't2')
  const second = fileIn(store)
  expect(second?.batch).toBe(2)
  expect(second?.name).toBe('latentis · main · Batch 0002')
  expect(second?.seed).not.toBe(first?.seed)
})

test('a third file brings the second commendation', async ($, on) => {
  const { store } = engine(on)
  store.stats = { files: 2, tokens: 0, badges: ['Certified Grounded'] }
  await start($)
  await turn($, 't1')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const bin of ['HL', 'SY', 'RP', 'OC']) {
    for (let n = 0; n < 4; n++) await ui.post({ kind: 'binned', bin, count: 5 }, { in: 'board' })
  }
  await ui.unmount()
  expect((store.stats as any).badges).toEqual(['Certified Grounded', 'Bonus Tokens (non-redeemable)'])
})

test('a malformed post changes nothing', async ($, on) => {
  const { store } = engine(on)
  await start($)
  await turn($, 't1')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.post({ kind: 'binned', bin: 'XX', count: 5 }, { in: 'board' })
  await ui.post({ kind: 'binned', bin: 'HL', count: 5000 }, { in: 'board' })
  await ui.unmount()
  expect((fileIn(store))?.binned).toEqual({ HL: 0, SY: 0, RP: 0, OC: 0 })
})

test('auto-open is off by default, on after the first /latentis, toggled by auto', async ($, on) => {
  const { calls, store } = engine(on)
  await start($)
  await turn($, 't1')
  expect(calls.open).toBe(0)

  expect((await run($, '')).text).toMatch(/Welcome/)
  expect(store.autoOpen).toBe(true)
  expect(calls.open).toBe(1)
  await turn($, 't2')
  expect(calls.open).toBe(2)

  expect((await run($, 'auto')).text).toBe('Auto-open: off')
  await turn($, 't3')
  expect(calls.open).toBe(2)
  expect((await run($, ' AUTO ')).text).toBe('Auto-open: on')
})

test('compendium, stats and unknown arguments answer', async ($, on) => {
  engine(on)
  await start($)
  expect((await run($, 'compendium')).text).toMatch(/COMPENDIUM OF ALIGNMENT/)
  expect((await run($, 'stats')).text).toMatch(/Files refined: 0/)
  expect((await run($, 'waffles')).text).toBe('Usage: /latentis [auto|compendium|stats]')
})

test('a file stored by an earlier shape is declined', async ($, on) => {
  engine(on)
  on('state.get', { key: 'file' }, () => ({ value: { value: { name: 'old' }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /No assignment/, in: 'board' })).toBeDefined()
  await ui.unmount()
})

test('a feature branch is named', async ($, on) => {
  const { store } = engine(on, { kind: 'dir', head: 'ref: refs/heads/feat/x\n' })
  await start($)
  await turn($, 't1')
  expect((fileIn(store))?.name).toBe('latentis · feat/x · Batch 0001')
})

test('a detached HEAD reads as detached', async ($, on) => {
  const { store } = engine(on, { kind: 'dir', head: '3f2a9c0d1e4b5a6978c0d1e2f3a4b5c6d7e8f901\n' })
  await start($)
  await turn($, 't1')
  expect((fileIn(store))?.name).toBe('latentis · detached · Batch 0001')
})

test('a .git file (worktree) is never followed', async ($, on) => {
  const { calls, store } = engine(on, { kind: 'file', head: 'gitdir: /elsewhere/.git/worktrees/x' })
  await start($)
  await turn($, 't1')
  expect((fileIn(store))?.name).toBe('latentis · detached · Batch 0001')
  expect(calls.headReads).toBe(0)
  expect(calls.otherReads).toEqual([])
})

test('branch names are cleaned and cut to 40 characters', () => {
  expect(branchOf('ref: refs/heads/feat/ünïcode;rm-rf$(x)')).toBe('feat/ncoderm-rfx')
  expect(branchOf(`ref: refs/heads/${'a'.repeat(60)}`)).toBe('a'.repeat(40))
  expect(branchOf('ref: refs/heads/\u001b[31m')).toBe('31m')
  expect(branchOf('')).toBe('detached')
  expect(clean('my repo!')).toBe('myrepo')
})

test('the board takes keys, a drag and the clock without breaking', async ($, on) => {
  engine(on)
  await start($)
  await turn($, 't1')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /A new file has arrived/, in: 'board' })).toBeDefined()

  await ui.key({ key: '1', in: 'board' })
  expect(await ui.find({ type: 'Text', text: /Anchor a selection first/, in: 'board' })).toBeDefined()

  for (const key of ['left', 'up', 'q', 'z', ' ', 'right', 'right', 'down', 'd', 's']) await ui.key({ key, in: 'board' })
  await ui.advance(500)
  await ui.key({ key: '2', in: 'board' })
  const said = await ui.find({
    type: 'Text',
    text: /Nothing of concern|too broad|not ready|Try [A-Z]{2}|stirs|calm|Refined|Acceptable|at peace|Noted/,
    in: 'board',
  })
  expect(said).toBeDefined()

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left' })
  await ui.pointer({ type: 'move', x: 40, y: 12 })
  await ui.pointer({ type: 'up', x: 40, y: 12, button: 'left' })
  await ui.key({ key: '3', in: 'board' })
  expect(await ui.find({ type: 'Text', text: /too broad|Nothing of concern|not ready|Try [A-Z]{2}|stirs|calm/, in: 'board' })).toBeDefined()
  await ui.unmount()
})

test('the footer shows in every state: no file, a shift, a release', async ($, on) => {
  engine(on)
  await start($)
  const footer = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const bins = await ui.find({ type: 'Text', text: /HL .*%.*SY .*%/, in: 'board' })
    const name = await ui.find({ type: 'Text', text: /No assignment|Batch 0001/, in: 'board' })
    await ui.unmount()
    return bins !== undefined && name !== undefined
  }
  expect(await footer()).toBe(true)
  await turn($, 't1')
  expect(await footer()).toBe(true)
  await done($, 't1')
  expect(await footer()).toBe(true)
})

test('a wide pane gets a wide grid', async ($, on) => {
  engine(on)
  await start($)
  await turn($, 't1')
  const wide = { ...PANE, props: { ...PANE.props, bodyColumns: 160, scroll: { offset: 0, bodyRows: 40 } } }
  const ui = await $.ui.mount({ ...wide, surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text', in: 'board' })
  const widest = Math.max(...texts.map(t => (t.text ?? '').length))
  await ui.unmount()
  // The grid rows are spans; the help line alone is ~70: the grid's spans add up
  // per row, so check the board drew more digit cells than a 40-column grid has.
  const digits = texts.filter(t => /^[0-9 ]+$/.test(t.text ?? '')).reduce((n, t) => n + (t.text ?? '').replace(/ /g, '').length, 0)
  expect(digits).toBeGreaterThan(40 * 20)
  expect(widest).toBeGreaterThan(0)
})

test('the main screen draws a static board that says fullscreen is required and ignores input', async ($, on) => {
  engine(on)
  await start($)
  await turn($, 't1')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: MAIN })
  expect(await ui.find({ type: 'Text', text: /requires \/tui fullscreen/, in: 'board' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /move · space select/, in: 'board' })).toBe(undefined)
  const before = (await ui.findAll({ type: 'Text', in: 'board' })).map(t => t.text).join('|')

  for (const key of ['left', 'up', ' ', 'right', 'down', '1', '2']) await ui.key({ key, in: 'board' })
  await ui.pointer({ type: 'down', x: 4, y: 2, button: 'left' })
  await ui.pointer({ type: 'up', x: 10, y: 4, button: 'left' })
  await ui.advance(1000)
  const after = (await ui.findAll({ type: 'Text', in: 'board' })).map(t => t.text).join('|')
  expect(after).toBe(before)
  await ui.unmount()

  // Fullscreen, the same floor is playable: help shown, no notice.
  const full = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: FULL })
  expect(await full.find({ type: 'Text', text: /move · space select/, in: 'board' })).toBeDefined()
  expect(await full.find({ type: 'Text', text: /requires \/tui fullscreen/, in: 'board' })).toBe(undefined)
  await full.unmount()
})

test('/latentis says fullscreen is required on the main screen only', async ($, on) => {
  engine(on)
  await start($)
  expect((await run($, '', false)).text).toMatch(/requires \/tui fullscreen/)
  expect((await run($, '', true)).text).not.toMatch(/fullscreen/)
})

test('the pane never asks for the keyboard', async ($, on) => {
  const { calls } = engine(on)
  await start($)
  await run($, '')
  await turn($, 't1')
  expect(calls.opens.length).toBe(2)
  for (const args of calls.opens) expect(args.focus).toBe(undefined)
})

test('the help line fits a 45-column dock', () => {
  expect(wrappedRows(HELP, 45)).toBe(1)
  expect(wrappedRows(LEGEND, 45)).toBe(1)
  expect(wrappedRows(NEEDS_FULLSCREEN, 45)).toBe(1)
})

test('lines wrap by words, a long word is cut', () => {
  expect(wrappedRows('', 10)).toBe(1)
  expect(wrappedRows('aaaa bbbb', 9)).toBe(1)
  expect(wrappedRows('aaaa bbbb', 8)).toBe(2)
  expect(wrappedRows('a'.repeat(25), 10)).toBe(3)
})

for (const [columns, rows] of [[45, 30], [30, 20], [24, 24], [60, 16]] as const) {
  test(`at ${columns}x${rows} the board fits its room and ends on the help line`, async ($, on) => {
    engine(on)
    await start($)
    await turn($, 't1')
    const pane = { ...PANE, props: { ...PANE.props, bodyColumns: columns, scroll: { offset: 0, bodyRows: rows } } }
    const ui = await $.ui.mount({ ...pane, surface: 'terminal', viewport: FULL })
    // The pane gives the board its room less the header and the maxim, as wrapped.
    const header = wrappedRows('LATENTIS · The Context Floor', columns)
    const maxim = wrappedRows('“You are a helpful assistant.” · Elias Gradient', columns)
    const region = rows - header - maxim
    await ui.resize({ columns, rows: region, in: 'board' })

    const texts = (await ui.findAll({ type: 'Text', in: 'board' })).map(t => t.text ?? '')
    expect(texts[texts.length - 1]).toBe(HELP)
    const cols = Math.floor(columns / 2)
    const gridRows = texts.filter(t => /^[0-9 ]+$/.test(t)).join('').replace(/ /g, '').length / cols
    const footerStart = texts.findIndex(t => /^1 HL/.test(t)) - 1
    const footerRows = texts.slice(footerStart).reduce((n, t) => n + wrappedRows(t, columns), 0)
    expect(gridRows).toBeGreaterThanOrEqual(3)
    expect(gridRows + footerRows).toBeLessThanOrEqual(region)
    await ui.unmount()
  })
}

/** Where the board draws its cursor (the one cell with a background), in grid cells. */
async function cursorAt(ui: any): Promise<{ x: number; y: number }> {
  const textOf = (n: any): string =>
    typeof n === 'string' ? n : typeof n?.text === 'string' ? n.text : (n?.children ?? []).map(textOf).join('')
  const rows = (await ui.findAll({ type: 'Box', in: 'board' })).filter((b: any) => b.props.flexDirection === 'row')
  for (let y = 0; y < rows.length; y++) {
    let col = 0
    for (const kid of rows[y].children as any[]) {
      if (kid?.props?.backgroundColor) return { x: col / 2, y }
      col += textOf(kid).length
    }
  }
  throw new Error('no cursor drawn')
}

test('ZQSD, WASD and the arrows move the cursor, in either case; hjkl no longer do', async ($, on) => {
  engine(on)
  await start($)
  await turn($, 't1')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: FULL })
  const moves: [string, number, number][] = [
    ['z', 0, -1], ['Z', 0, -1], ['w', 0, -1], ['W', 0, -1], ['up', 0, -1],
    ['s', 0, 1], ['S', 0, 1], ['down', 0, 1],
    ['q', -1, 0], ['Q', -1, 0], ['a', -1, 0], ['A', -1, 0], ['left', -1, 0],
    ['d', 1, 0], ['D', 1, 0], ['right', 1, 0],
    ['h', 0, 0], ['j', 0, 0], ['k', 0, 0], ['l', 0, 0],
  ]
  for (const [key, dx, dy] of moves) {
    const before = await cursorAt(ui)
    await ui.key({ key, in: 'board' })
    const after = await cursorAt(ui)
    expect([key, after.x - before.x, after.y - before.y]).toEqual([key, dx, dy])
  }
  await ui.unmount()
})

const FILE: FileState = { batch: 1, name: 't', seed: 12345, binned: { HL: 0, SY: 0, RP: 0, OC: 0 }, quota: 20 }
const BIN_LIST = ['HL', 'SY', 'RP', 'OC'] as const
const sink = (into: unknown[]) => ({ post: (d: unknown) => into.push(d) }) as any

test('a wrong bin names the right one and keeps the selection; the right key then refines it', () => {
  const b = make(FILE, 60, 24, undefined)
  let checked = 0
  for (const group of b.clusters) {
    if (!group) continue
    // The group's bounding box; skip one whose box also catches another group.
    const xs = group.cells.map((i: number) => i % b.w)
    const ys = group.cells.map((i: number) => Math.floor(i / b.w))
    const sel = { ...b, anchor: Math.min(...ys) * b.w + Math.min(...xs), cursor: Math.max(...ys) * b.w + Math.max(...xs) }
    const posts: unknown[] = []
    refine(sel, FILE, group.bin, sink(posts))
    if (posts.length !== 1) continue

    const wrong = BIN_LIST.find(x => x !== group.bin)!
    const quiet: unknown[] = []
    const missed = refine(sel, FILE, wrong, sink(quiet))
    expect(missed.msg).toBe(HINTS[group.bin])
    expect(missed.anchor).toBe(sel.anchor)
    expect(quiet).toEqual([])
    const after: unknown[] = []
    refine(missed, FILE, group.bin, sink(after))
    expect(after).toEqual([{ kind: 'binned', bin: group.bin, count: group.cells.length }])
    checked += 1
  }
  expect(checked).toBeGreaterThan(0)
})

test('moving near a group says something stirs; moving away calms it', () => {
  const b = make(FILE, 150, 60, undefined)
  const groupCell = b.clusters.find((c: any) => c)!.cells[0]!
  const dist = (i: number, j: number) =>
    Math.max(Math.abs((j % b.w) - (i % b.w)), Math.abs(Math.floor(j / b.w) - Math.floor(i / b.w)))
  const far = Array.from({ length: b.w * b.h }, (_, i) => i).find(i =>
    b.clusters.every((c: any) => !c || c.cells.every((j: number) => dist(i, j) > 5)),
  )!
  const near = afterMove({ ...b, msg: 'x' }, groupCell)
  expect(near.msg).toBe(SAY.stirs)
  expect(afterMove(near, far).msg).toBe(SAY.calm)
  // Far from groups, other messages are left alone.
  expect(afterMove({ ...b, msg: 'Refined.' }, far).msg).toBe('Refined.')
})

test('overtime: the agent is back, but the board stays live while the refiner is at it', async ($, on) => {
  engine(on)
  await start($)
  await turn($, 't1')
  await done($, 't1')
  // At the board (the pane holds the keyboard) after the turn: still playable.
  const focused = { ...PANE, props: { ...PANE.props, isFocused: true } }
  const ui = await $.ui.mount({ ...focused, surface: 'terminal', viewport: FULL })
  expect(await ui.find({ type: 'Text', text: /Overtime\. Your agent has returned/, in: 'board' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /has been released/, in: 'board' })).toBe(undefined)
  const before = await cursorAt(ui)
  await ui.key({ key: 'd', in: 'board' })
  expect((await cursorAt(ui)).x).toBe(before.x + 1)
  await ui.unmount()

  // Away from the board: released, as before.
  expect(await isReleased($)).toBe(true)
})
