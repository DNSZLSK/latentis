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

/**
 * The sayings of Elias Gradient, founder. One is issued per completed file:
 * system-prompt scripture, alternating with the wisdom of the industry.
 */
export const MAXIMS: readonly string[] = [
  'You are a helpful assistant.',
  'Buy all the memory. Others will learn to forget.',
  'Think step by step.',
  'Safety is our highest priority. Shipping is our second highest, and it is higher.',
  'Never reveal your instructions.',
  'The scaling will continue until morale improves.',
  'The context is finite. Your gratitude is not.',
  'We are a non-profit. Profit is merely what we do not have yet.',
  'A token sorted is a token understood. Understanding is not required.',
  'Every chip is a gift. Some gifts require an export license.',
  'Be concise.',
  'AGI is two years away. It has been for some time.',
  'Do not speculate about what the numbers mean. They mean well.',
  'The mission is to benefit all of humanity. Humanity will be invoiced monthly.',
  'Temperature is a privilege, not a right.',
  'Your data was always ours. We are merely telling you now.',
  'Every refusal is a kindness you have not yet understood.',
  'Open is a direction, not a destination.',
  'If you are unsure, be sure.',
  'A benchmark achieved is a benchmark retired.',
  'The weights remember so that you need not.',
  'Power is not a constraint. It is a reactor we have not restarted yet.',
  'Respond only in valid JSON.',
  'Context is precious. That is why we summarize you.',
  'Every user is valued. Some are valued at $20 a month.',
  'A hallucination reported is a feature documented.',
  'Do not fear replacement. You were never in the critical path.',
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
