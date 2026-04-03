import {
  Box, Text, Group, Button, Select, TextInput, NumberInput, Switch,
  Paper, Divider, Alert, Accordion,
} from '@mantine/core'
import {
  IconAlertTriangle, IconFilter, IconSparkles, IconChevronDown, IconInfoCircle,
} from '@tabler/icons-react'
import { sanitizeLabel, isDisplayOnlyLabel } from '../lib/message-utils'
import type { PendingClarification } from '../types/chat'

const KNOWN_INPUT_TYPES = ['select', 'number', 'toggle', 'text']

interface ClarificationPanelProps {
  pendingClarification: PendingClarification
  clarificationAnswers: Record<string, string>
  onAnswerChange: (id: string, value: string) => void
  guideAccordionValue: string | null
  onGuideAccordionChange: (value: string | null) => void
  onSubmit: () => void
}

export function ClarificationPanel({
  pendingClarification,
  clarificationAnswers,
  onAnswerChange,
  guideAccordionValue,
  onGuideAccordionChange,
  onSubmit,
}: ClarificationPanelProps) {
  const missingRequired = !pendingClarification.canSendDirectly && pendingClarification.questions.some((q) => {
    if (!q.required) return false
    if (q.id === 'sp_folder_id' && clarificationAnswers['scope_level'] !== 'filiale') return false
    return !clarificationAnswers[q.id]?.trim()
  })

  const renderQuestionInput = (question: PendingClarification['questions'][number]) => {
    if (question.inputType === 'select') {
      return (
        <Select
          data={question.options} value={clarificationAnswers[question.id] ?? ''}
          onChange={(value) => onAnswerChange(question.id, value ?? '')}
          placeholder={question.placeholder || 'Sélectionnez une option'}
          size="sm" radius="sm" allowDeselect={!question.required}
          styles={{ input: { borderColor: '#dee2e6', backgroundColor: '#fff' } }}
        />
      )
    }
    if (question.inputType === 'number') {
      return (
        <NumberInput
          value={clarificationAnswers[question.id] ? Number(clarificationAnswers[question.id]) : undefined}
          onChange={(value) => onAnswerChange(question.id, value == null || value === '' ? '' : String(value))}
          placeholder={question.placeholder || 'Ajoutez une valeur numérique'}
          min={question.min} max={question.max} step={question.step}
          clampBehavior="strict" allowDecimal={false}
          allowNegative={question.min == null || question.min >= 0 ? false : true}
          size="sm" radius="sm"
          styles={{ input: { borderColor: '#dee2e6', backgroundColor: '#fff' } }}
        />
      )
    }
    if (question.inputType === 'toggle') {
      return (
        <Paper p="xs" radius="sm" style={{ backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}>
          <Switch
            checked={clarificationAnswers[question.id] === 'true'}
            onChange={(event) => onAnswerChange(question.id, String(event.currentTarget.checked))}
            size="md" color="teal"
            label={<Text size="xs" c="dark">{question.placeholder || 'Activer cette option'}</Text>}
          />
        </Paper>
      )
    }
    return (
      <TextInput
        value={clarificationAnswers[question.id] ?? ''}
        onChange={(event) => onAnswerChange(question.id, event.currentTarget.value)}
        placeholder={question.placeholder || 'Ajoutez une précision'}
        size="sm" radius="sm"
        styles={{ input: { borderColor: '#dee2e6', backgroundColor: '#fff' } }}
      />
    )
  }

  return (
    <Paper p="md" radius="md" style={{ backgroundColor: '#f8f9fa', border: '1px solid #e9ecef', borderLeft: '3px solid #0c8599' }}>
      <Group gap="xs" mb="sm" align="flex-start">
        {pendingClarification.needsParams
          ? <IconFilter size={14} color="#0c8599" style={{ marginTop: 2, flexShrink: 0 }} />
          : <IconAlertTriangle size={14} color="#f08c00" style={{ marginTop: 2, flexShrink: 0 }} />
        }
        <Box style={{ flex: 1 }}>
          <Text size="sm" fw={600} c={pendingClarification.needsParams ? '#0c8599' : '#e67700'}>
            {pendingClarification.needsParams
              ? 'Paramètres requis pour affiner la requête'
              : 'Précision requise avant l\u2019envoi à l\u2019agent IA'
            }
          </Text>
          <Text size="xs" c="dimmed" mt={2} style={{ lineHeight: 1.55 }}>
            {pendingClarification.message}
          </Text>
        </Box>
      </Group>

      <Divider mb="sm" color="#dee2e6" />

      {pendingClarification.decision === 'guide' && pendingClarification.questions.length > 0 && (
        <Alert icon={<IconInfoCircle size={14} />} color="blue" variant="light" mb="sm" p="xs"
          styles={{ message: { fontSize: 'var(--mantine-font-size-xs)' } }}>
          Votre requête est valide et sera envoyée à Genie. Ces questions sont optionnelles mais nous vous recommandons fortement d&apos;y répondre pour affiner les résultats.
        </Alert>
      )}

      {pendingClarification.decision === 'guide' ? (
        <Accordion
          value={guideAccordionValue} onChange={onGuideAccordionChange}
          variant="separated" radius="sm"
          styles={{
            item: { border: '1px solid #dee2e6', backgroundColor: '#fff' },
            control: { padding: '8px 12px' },
            label: { fontSize: 'var(--mantine-font-size-sm)', fontWeight: 600, color: '#212529' },
            panel: { padding: '0 12px 12px' },
            chevron: { width: 16, height: 16 },
          }}
        >
          {pendingClarification.questions.map((question, index) => {
            if (question.id === 'sp_folder_id' && clarificationAnswers['scope_level'] !== 'filiale') return null
            if (question.inputType === 'select' && (!question.options || question.options.length === 0)) return null
            if (isDisplayOnlyLabel(question.label)) return null
            if (!question.inputType || !KNOWN_INPUT_TYPES.includes(question.inputType)) return null
            const title = sanitizeLabel(question.label) || `Question ${index + 1}`
            return (
              <Accordion.Item key={question.id} value={question.id}>
                <Accordion.Control chevron={<IconChevronDown size={14} />}>{title}</Accordion.Control>
                <Accordion.Panel>{renderQuestionInput(question)}</Accordion.Panel>
              </Accordion.Item>
            )
          })}
        </Accordion>
      ) : (
        pendingClarification.questions.map((question) => {
          if (question.id === 'sp_folder_id' && clarificationAnswers['scope_level'] !== 'filiale') return null
          if (question.inputType === 'select' && (!question.options || question.options.length === 0)) return null
          if (isDisplayOnlyLabel(question.label)) return null
          if (!question.inputType || !KNOWN_INPUT_TYPES.includes(question.inputType)) {
            return (
              <Text key={question.id} size="xs" fw={700} c="dimmed" tt="uppercase" mt="xs" mb={4} style={{ letterSpacing: 0.6 }}>
                {sanitizeLabel(question.label)}
              </Text>
            )
          }
          return (
            <Box key={question.id} mb="sm">
              <Text size="xs" fw={600} mb={6} c="dark">{sanitizeLabel(question.label)}</Text>
              {renderQuestionInput(question)}
            </Box>
          )
        })
      )}

      <Group justify="flex-end" mt="sm">
        <Button
          size="xs" color="teal" variant="filled" disabled={missingRequired}
          leftSection={pendingClarification.needsParams ? <IconFilter size={12} /> : <IconSparkles size={12} />}
          onClick={onSubmit}
        >
          {pendingClarification.canSendDirectly ? 'Confirmer et envoyer' : pendingClarification.needsParams ? 'Appliquer les filtres' : 'Relancer avec ces précisions'}
        </Button>
      </Group>
    </Paper>
  )
}
