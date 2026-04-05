import { useState } from 'react'
import { Select, TextInput, NumberInput, Switch, Button } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { useStateStore } from '@json-render/react'

/* ------------------------------------------------------------------
 * Bound form-input components used by the json-render registry.
 * These are regular React components (hooks allowed). Registry
 * components cannot use hooks directly (Bug 22/27/28), so the registry
 * delegates to these via JSX, creating proper React fibers.
 * When the spec uses $bindState, `bindings?.value` carries the state
 * path and changes are written back to the JSONUIProvider state.
 * ------------------------------------------------------------------ */

/** Safely convert an unknown prop value to a primitive string. */
function toStr(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    ? String(v)
    : ''
}

export function BoundSelectInput({ label, placeholder, data, value, bindingPath, required, disabled }: {
  label?: unknown; placeholder?: unknown; data?: unknown; value?: unknown
  bindingPath?: string; required?: unknown; disabled?: unknown
}) {
  const { set } = useStateStore()
  const [localValue, setLocalValue] = useState<string | null>(
    value != null && value !== '' ? toStr(value) : null
  )
  const handleChange = (v: string | null) => {
    setLocalValue(v)
    if (bindingPath) set(bindingPath, v ?? '')
  }
  return (
    <Select
      label={label as string} placeholder={placeholder as string} data={data as never}
      value={localValue} onChange={handleChange}
      required={Boolean(required)} disabled={Boolean(disabled)}
      size="sm" radius="sm"
    />
  )
}

export function BoundNumberInput({ label, placeholder, value, min, max, step, bindingPath, required, disabled }: {
  label?: unknown; placeholder?: unknown; value?: unknown
  min?: unknown; max?: unknown; step?: unknown
  bindingPath?: string; required?: unknown; disabled?: unknown
}) {
  const { set } = useStateStore()
  const [localValue, setLocalValue] = useState<number | ''>(
    value != null && value !== '' ? Number(value) : ''
  )
  const handleChange = (v: number | string) => {
    const next: number | '' = v === '' ? '' : Number(v)
    setLocalValue(next)
    if (bindingPath) set(bindingPath, next === '' ? null : next)
  }
  const hasBounds = min != null || max != null
  return (
    <NumberInput
      label={label as string} placeholder={placeholder as string}
      value={localValue} onChange={handleChange}
      min={min as number} max={max as number} step={step as number}
      clampBehavior={hasBounds ? 'strict' : 'none'}
      allowNegative={min != null ? (min as number) < 0 : true}
      required={Boolean(required)} disabled={Boolean(disabled)}
      size="sm" radius="sm"
    />
  )
}

export function BoundTextInput({ label, placeholder, value, bindingPath, required, disabled }: {
  label?: unknown; placeholder?: unknown; value?: unknown
  bindingPath?: string; required?: unknown; disabled?: unknown
}) {
  const { set } = useStateStore()
  const [localValue, setLocalValue] = useState(value != null ? toStr(value) : '')
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.currentTarget.value)
    if (bindingPath) set(bindingPath, e.currentTarget.value)
  }
  return (
    <TextInput
      label={label as string} placeholder={placeholder as string}
      value={localValue} onChange={handleChange}
      required={Boolean(required)} disabled={Boolean(disabled)}
      size="sm" radius="sm"
    />
  )
}

export function BoundToggle({ label, description, checked, bindingPath, disabled }: {
  label?: unknown; description?: unknown; checked?: unknown
  bindingPath?: string; disabled?: unknown
}) {
  const { set } = useStateStore()
  const [localChecked, setLocalChecked] = useState(Boolean(checked))
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalChecked(e.currentTarget.checked)
    if (bindingPath) set(bindingPath, e.currentTarget.checked)
  }
  return (
    <Switch
      label={label as string} description={description as string}
      checked={localChecked} onChange={handleChange}
      disabled={Boolean(disabled)} color="teal" size="md"
    />
  )
}

/**
 * Signals form submission by setting `/submitRequested = true` in the
 * JSONUIProvider state. MessageContent detects this flag via onStateChange
 * and calls onSpecSubmit with the current form state.
 */
export function BoundSubmitButton({ label }: { label?: unknown }) {
  const { set } = useStateStore()
  return (
    <Button
      size="sm"
      variant="light"
      color="teal"
      leftSection={<IconRefresh size={14} />}
      onClick={() => set('/submitRequested', true)}
    >
      {typeof label === 'string' && label.length > 0 ? label : 'Relancer l\'analyse'}
    </Button>
  )
}
