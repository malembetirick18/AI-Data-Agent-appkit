import type { Spec } from '@json-render/core'

export type GenericUiSpec = Spec

export interface ControllerQuestionOption {
  value: string
  label: string
}

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
