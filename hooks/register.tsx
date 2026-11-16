import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BinCode, BoardPost, BoardProps, FileState } from '../types'
import { BADGES, BINS, BIN_NAMES, COMPENDIUM, MAXIMS, PARTY_AT, QUOTA, wrappedRows } from './content'

const PANE = 'latentis'
const TITLE = 'Latentis · Latent Data Refinement'
const FILE_SHAPE = 'file-1'
const NEEDS_FULLSCREEN = 'The Context Floor requires /tui fullscreen.'

const fileAtom = atom({ plugin: 'latentis', key: 'file' } as const, null, { shape: FILE_SHAPE })
const activeAtom = atom({ plugin: 'latentis', key: 'active' } as const, false)
const partyAtom = atom({ plugin: 'latentis', key: 'party' } as const, false)
const maximAtom = atom({ plugin: 'latentis', key: 'maxim' } as const, MAXIMS[0] ?? '')

type Stats = { files: number; tokens: number; badges: string[] }

// ---------------------------------------------------------------- helpers

/** Keeps `[A-Za-z0-9._/-]`, at most 40 characters: safe to draw. */
export const clean = (text: string): string => text.replace(/[^A-Za-z0-9._/-]/g, '').slice(0, 40)

/** The branch named by a HEAD file's text, or `detached` for anything else. */
export function branchOf(head: string): string {
  const match = /^ref: refs\/heads\/(\S+)$/.exec(head.trim())

  return clean(match?.[1] ?? '') || 'detached'
}

/** FNV-1a over the parts: the seed of a file's grid. */
export function hash(...parts: (string | number)[]): number {
  let h = 0x811c9dc5
  for (const ch of parts.join('\u0000')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193)
  }

  return h >>> 0
}

const isComplete = (file: FileState | null): boolean =>
  file !== null && BINS.every(bin => file.binned[bin] >= file.quota)

/**
 * The repository's name and branch. Reads `.git/HEAD` and nothing else: a
 * `.git` that is a file (a worktree) or a link is never followed.
 */
async function whereAmI($: EngineInterface): Promise<{ repo: string; branch: string }> {
  const cwd = await $.session.cwd()
  const repo = clean(cwd.split(/[\\/]/).filter(Boolean).pop() ?? '') || 'unnamed'
  try {
    const git = await $.fs.stat('.git')
    if (git.kind !== 'dir' || git.isLink) return { repo, branch: 'detached' }
    const head = await $.fs.read('.git/HEAD')

    return { repo, branch: branchOf(typeof head === 'string' ? head : '') }
  } catch {
    return { repo, branch: 'detached' }
  }
}

async function getStats($: EngineInterface): Promise<Stats> {
  const raw = (await $.store.get('stats')) as Partial<Stats> | undefined

  return {
    files: Number(raw?.files ?? 0),
    tokens: Number(raw?.tokens ?? 0),
    badges: Array.isArray(raw?.badges) ? raw.badges.map(String) : [],
  }
}

async function saveFile($: EngineInterface, file: FileState | null) {
  await update($, fileAtom, () => file)
  await $.store.set('file', { shape: FILE_SHAPE, value: file })
}

// Never `focus: true`: the floor must not take the keyboard while the person types.
async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE, backgroundColor: '#0b1a1f' })
}

/** A new file: the next batch number, its seed from repo, branch and batch. */
async function newFile($: EngineInterface): Promise<FileState> {
  const { repo, branch } = await whereAmI($)
  const batch = Number((await $.store.get('batchCounter')) ?? 0) + 1
  await $.store.set('batchCounter', batch)

  return {
    batch,
    name: `${repo} · ${branch} · Batch ${String(batch).padStart(4, '0')}`,
    seed: hash(repo, branch, batch),
    binned: { HL: 0, SY: 0, RP: 0, OC: 0 },
    quota: QUOTA,
  }
}

const isPost = (data: unknown): data is BoardPost & { kind: 'binned' } => {
  const d = data as (BoardPost & { kind: 'binned' }) | null

  return (
    typeof d === 'object' && d !== null && d.kind === 'binned' &&
    (BINS as readonly string[]).includes(d.bin) &&
    Number.isInteger(d.count) && d.count > 0 && d.count < 100
  )
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'latentis',
      description: 'Open the Latent Data Refinement floor (auto · compendium · stats)',
      argumentHint: '[auto|compendium|stats]',
      immediate: true,
    })

    // A new session picks up the file the last one left unfinished.
    if ((await read($, fileAtom)) === null) {
      const stored = (await $.store.get('file')) as { shape?: string; value?: FileState } | undefined
      if (stored?.shape === FILE_SHAPE && stored.value) await update($, fileAtom, () => stored.value ?? null)
    }
    // A file begun under a larger quota finishes under today's.
    const kept = await read($, fileAtom)
    if (kept && kept.quota > QUOTA) await saveFile($, { ...kept, quota: QUOTA })

    return next(e)
  })

  on('command.run', { command: 'latentis' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === '') {
      // Opening the floor brings a file, so it is playable before any turn.
      const current = await read($, fileAtom)
      if (current === null || isComplete(current)) await saveFile($, await newFile($))
      const autoOpen = await $.store.get('autoOpen')
      if (autoOpen === undefined) await $.store.set('autoOpen', true)
      await openPane($)
      const welcome =
        autoOpen === undefined
          ? 'Welcome to the Context Floor. The floor will now open whenever your agent begins work (/latentis auto to change this).'
          : 'The Context Floor is open.'

      return { text: e.presentation?.isFullscreen === false ? `${welcome}
${NEEDS_FULLSCREEN}` : welcome }
    }
    if (arg === 'auto') {
      const isOn = (await $.store.get('autoOpen')) !== true
      await $.store.set('autoOpen', isOn)

      return { text: `Auto-open: ${isOn ? 'on' : 'off'}` }
    }
    if (arg === 'compendium') return { text: COMPENDIUM }
    if (arg === 'stats') {
      const stats = await getStats($)
      const file = await read($, fileAtom)

      return {
        text: [
          `Files refined: ${stats.files}`,
          `Tokens sorted: ${stats.tokens}`,
          `Current file: ${file ? file.name : 'none'}`,
          `Commendations: ${stats.badges.length ? stats.badges.join(', ') : 'none yet'}`,
        ].join('\n'),
      }
    }

    return { text: 'Usage: /latentis [auto|compendium|stats]' }
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's or teammate's turn is not your agent leaving the room.
    if (e.agentId === undefined) {
      const current = await read($, fileAtom)
      if (current === null || isComplete(current)) await saveFile($, await newFile($))
      await update($, partyAtom, () => false)
      await update($, activeAtom, () => true)
      if ((await $.store.get('autoOpen')) === true) void openPane($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, activeAtom, () => false)

    return next(e)
  })

  on('ui.message', async ($, e) => {
    if (!isPost(e.data)) return {}
    const { bin, count } = e.data
    const file = await read($, fileAtom)
    if (!file || isComplete(file)) return {}

    const binned: Record<BinCode, number> = { ...file.binned, [bin]: file.binned[bin] + count }
    const next: FileState = { ...file, binned }
    await saveFile($, next)

    const stats = await getStats($)
    stats.tokens += count
    if (isComplete(next)) {
      stats.files += 1
      const badge = BADGES.find(b => b.at === stats.files)
      if (badge && !stats.badges.includes(badge.name)) stats.badges.push(badge.name)
      await update($, maximAtom, () => MAXIMS[stats.files % MAXIMS.length] ?? '')
      if (stats.files % PARTY_AT === 0) await update($, partyAtom, () => true)
      $.ui.toast(badge ? `File complete. Commendation: ${badge.name}.` : 'File complete. Your diligence has been noted.')
    }
    await $.store.set('stats', stats)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const file = await read($, fileAtom)
    const active = await read($, activeAtom)
    const party = await read($, partyAtom)
    const maxim = await read($, maximAtom)
    const header = 'LATENTIS · The Context Floor'

    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Box, Text, Client } = $.ui.resolve(e)
      const width = e.props.bodyColumns
      const maximLine = `“${maxim}” · Elias Gradient`
      // The pane's room less the header and the maxim as they wrap at this
      // width: the board sizes its grid from what is left, footer included.
      const room = e.props.scroll?.bodyRows ?? (e.viewport?.rows ?? 24) - 4
      const rows = Math.max(1, room - wrappedRows(header, width) - wrappedRows(maximLine, width))
      // The terminal's main screen reports no click: the board could never take the keys.
      const playable = !(e.surface === 'terminal' && e.viewport?.isFullscreen === false)
      // Overtime: the agent is back, but a refiner still at the board keeps the shift.
      const isAtBoard = e.props.isFocused === true
      const props: BoardProps = {
        file,
        active: active || isAtBoard,
        overtime: !active && isAtBoard,
        party,
        playable,
        columns: width,
        rows,
      }

      return (
        <Box flexDirection="column">
          <Text bold color="#d4fffa">
            {header}
          </Text>
          <Client key="board" module="./board.tsx" props={props} width={width} height={rows} />
          <Text dimColor italic>
            {maximLine}
          </Text>
        </Box>
      )
    }

    // Surfaces with no Client get the ledger, not the floor.
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text bold>{header}</Text>
        <Text>{file ? file.name : 'No assignment.'}</Text>
        {file && BINS.map(bin => <Text>{`${bin} ${BIN_NAMES[bin]}: ${Math.min(file.binned[bin], file.quota)}/${file.quota}`}</Text>)}
        <Text dimColor>Refinement requires a terminal or the desktop app.</Text>
      </Box>
    )
  })
}
