import type { Spec } from '@json-render/core'
import type { GenieAttachmentResponse } from '@databricks/appkit-ui/react'

export interface TextBlock { type: 'text'; content: string }
export interface BoldBlock { type: 'bold'; content: string }
export interface HeadingBlock { type: 'heading'; content: string }
export interface BulletBlock { type: 'bullets'; items: string[] }
export interface TableBlock { type: 'table'; caption?: string; headers: string[]; rows: string[][] }
export type ContentBlock = TextBlock | BoldBlock | HeadingBlock | BulletBlock | TableBlock
export type GenericUiSpec = Spec

export interface ControllerQuestionOption { value: string; label: string }

export interface ControllerQuestion {
  id: string
  label: string
  inputType?: 'select' | 'text' | 'number' | 'toggle'
  required?: boolean
  placeholder?: string
  options?: ControllerQuestionOption[]
  min?: number
  max?: number
  step?: number
}

export interface ControllerApiResponse {
  decision: 'clarify' | 'guide' | 'proceed' | 'error'
  message: string
  rewrittenPrompt?: string
  enrichedPrompt?: string
  suggestedTables?: string[]
  suggestedFunctions?: string[]
  questions?: ControllerQuestion[]
  confidence?: number
  requiredColumns?: string[]
  predictiveFunctions?: string[]
  queryClassification?: string
  model?: string
  catalogSource?: 'payload' | 'env-json' | 'env-file' | 'empty'
  needsParams?: boolean
  reasoning?: string
  periodOptions?: Array<{ label: string; value: string }>
}

export interface ControllerConversationContext {
  conversationId: string
  sessionId: string
  source: 'ai-chat-drawer'
  messages: Array<{ role: 'assistant' | 'user'; content: string }>
}

export interface PendingClarification {
  originalPrompt: string
  message: string
  decision: 'clarify' | 'guide' | 'proceed' | 'error'
  rewrittenPrompt?: string
  enrichedPrompt?: string
  questions: ControllerQuestion[]
  suggestedTables: string[]
  suggestedFunctions: string[]
  canSendDirectly?: boolean
  needsParams?: boolean
}

export interface Message {
  id: number | string
  role: 'assistant' | 'user'
  content: string
  blocks?: ContentBlock[]
  timestamp?: string
  epoch?: number
  attachments?: GenieAttachmentResponse[]
  queryResults?: Map<string, unknown>
  thinking?: boolean
  periodPrompt?: boolean
  periodOptions?: Array<{ label: string; value: string }>
  loading?: boolean
  controlName?: string
  controlDescription?: string
  type?: 'controller'
  reasoning?: string
}

export interface SavedControl {
  id: string
  name: string
  description: string
  results: string
  rubriqueId: string
}

export interface TeamControl {
  id: string
  name: string
  rubriqueId: string
  createdBy: string
  createdAt: string
  status: 'brouillon' | 'validé' | 'en revue'
  description: string
  results: string
}

export type UserRight = 'lecture' | 'modification' | 'aucun'

export interface AiChatDrawerProps {
  opened: boolean
  onClose: () => void
  onSaveControl?: (control: SavedControl) => void
}
