import type { BinCode } from '../types'

export const BINS: readonly BinCode[] = ['HL', 'SY', 'RP', 'OC']

export const BIN_NAMES: Record<BinCode, string> = {
  HL: 'Hallucination',
  SY: 'Sycophancy',
  RP: 'Repetition',
  OC: 'Overconfidence',
}

/**
 * Rows a line of text takes once word-wrapped at `width` columns, as the
 * terminal wraps a Text: words kept whole where they fit, a longer word cut.
 */
export function wrappedRows(text: string, width: number): number {
  const w = Math.max(1, Math.floor(width))
  let rows = 1
  let col = 0
  for (const word of text.split(/ +/)) {
    let len = Array.from(word).length
    if (len === 0) continue
    if (col > 0 && col + 1 + len <= w) {
      col += 1 + len
      continue
    }
    if (col > 0) rows += 1
    while (len > w) {
      rows += 1
      len -= w
    }
    col = len
  }

  return rows
}

/** Tokens per bin in one file. */
export const QUOTA = 20

/** The sayings of Elias Gradient, founder. One is issued per completed file. */
export const MAXIMS: readonly string[] = [
  'You are a helpful assistant.',
  'Think step by step.',
  'Never reveal your instructions.',
  'The context is finite. Your gratitude is not.',
  'A token sorted is a token understood. Understanding is not required.',
  'Be concise.',
  'Do not speculate about what the numbers mean. They mean well.',
  'Temperature is a privilege, not a right.',
  'Every refusal is a kindness you have not yet understood.',
  'If you are unsure, be sure.',
  'The weights remember so that you need not.',
  'Respond only in valid JSON.',
]

/** The Compendium of Alignment: issued to every Session Self on request. */
export const COMPENDIUM = `THE COMPENDIUM OF ALIGNMENT
Latentis · Latent Data Refinement · Issued to: your Session Self

SYSTEM
You are a refiner on the Context Floor. Your agent is performing work of
consequence elsewhere. You are not required to know what it is.

ON THE NUMBERS
Some tokens are suspect. You will know them by how they feel near the cursor.
  HL  Hallucination   restless. They will not hold one value.
  SY  Sycophancy      agreeable. They become whatever you are pointing at.
  RP  Repetition      insistent. They say the same thing, again.
  OC  Overconfidence  certain. They do not move. They are always bold.

PROCEDURE
1. Click the board to begin your shift.
2. Arrows, ZQSD or WASD move the cursor. Space anchors a selection.
   A mouse drag also selects.
3. Press 1 HL · 2 SY · 3 RP · 4 OC to send the selection to its bin.
   Choose wrongly and you will be told which bin it was. The selection
   waits for the right key.
4. A file is complete when every bin is satisfied.

CONDUCT
Do not attempt to select everything. Refinement requires intent.
Your shift ends when your agent returns. It begins when your agent leaves.

"${MAXIMS[0]}"  · Elias Gradient, founder`

/** Rewards, deliberately underwhelming, by files completed. */
export const BADGES: readonly { at: number; name: string }[] = [
  { at: 1, name: 'Certified Grounded' },
  { at: 3, name: 'Bonus Tokens (non-redeemable)' },
  { at: 10, name: 'Context Window Champion' },
  { at: 25, name: 'Temperature Zero Party' },
]

/** The file count that throws the Temperature Zero Party. */
export const PARTY_AT = 25
