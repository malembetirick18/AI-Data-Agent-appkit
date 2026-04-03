import type { ContentBlock, ControllerQuestion } from '../types/chat'

export function blocksToPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'text':
        case 'bold':
          return b.content
        case 'heading':
          return `\n${b.content}`
        case 'bullets':
          return b.items.map((i) => `  \u2022 ${i}`).join('\n')
        case 'table': {
          const header = b.headers.join(' | ')
          const sep = b.headers.map(() => '---').join(' | ')
          const rows = b.rows.map((r) => r.join(' | ')).join('\n')
          return [b.caption, header, sep, rows].filter(Boolean).join('\n')
        }
        default:
          return ''
      }
    })
    .join('\n')
}

/** Strip trailing parenthetical technical IDs and punctuation from a question label. */
export function sanitizeLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*[:;]\s*$/, '').trim()
}

/** Returns true for informational "current state" labels that should not be rendered as inputs. */
export function isDisplayOnlyLabel(label: string): boolean {
  return /actuel(le)?|valeur\s+actuelle|état\s+actuel|choix\s+actuel/i.test(label)
}

/** Format answered questions as a Q/R block for display in the chat. */
export function formatQRAnswers(
  questions: ControllerQuestion[],
  answers: Record<string, string>
): string {
  return questions
    .map((q) => {
      const raw = answers[q.id]?.trim()
      if (!raw) return null
      const label = sanitizeLabel(q.label)
      const display =
        q.inputType === 'select' && q.options
          ? (q.options.find((o) => o.value === raw)?.label ?? raw)
          : raw
      return `Q : ${label}\nR : ${display}`
    })
    .filter(Boolean)
    .join('\n\n')
}
