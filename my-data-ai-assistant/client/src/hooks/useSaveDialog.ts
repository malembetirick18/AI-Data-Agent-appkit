import { useState, useRef } from 'react'
import { inferRubriqueFromText, suggestedRubriqueMap } from '../lib/spec-utils'
import { blocksToPlainText } from '../lib/message-utils'
import type { Message, SavedControl, UserRight } from '../types/chat'

const INITIAL_USER_RIGHTS: Record<string, UserRight> = {}

export function useSaveDialog(onSaveControl?: (control: SavedControl) => void) {
  const [saveModalOpened, setSaveModalOpened] = useState(false)
  const [saveForm, setSaveForm] = useState({
    name: '', description: '', results: '', rubriqueId: '01',
  })
  const [aiSuggestedRubrique, setAiSuggestedRubrique] = useState<string | null>(null)
  const [rubriqueAlert, setRubriqueAlert] = useState(false)
  const [saved, setSaved] = useState(false)
  const [applyToGroup, setApplyToGroup] = useState(false)
  const [userRights, setUserRights] = useState<Record<string, UserRight>>(() => ({ ...INITIAL_USER_RIGHTS }))
  const lastSuggestionIndexRef = useRef(-1)

  const handleOpenSave = (msg: Message) => {
    const plainResults = msg.content + (msg.blocks ? '\n' + blocksToPlainText(msg.blocks) : '')
    const sugIdx = lastSuggestionIndexRef.current
    const inferredRubrique = sugIdx >= 0 && suggestedRubriqueMap[sugIdx]
      ? suggestedRubriqueMap[sugIdx]
      : inferRubriqueFromText(msg.controlName || msg.content || '')
    setSaveForm({
      name: msg.controlName || '',
      description: msg.controlDescription || '',
      results: plainResults.trim().slice(0, 2000),
      rubriqueId: inferredRubrique,
    })
    setAiSuggestedRubrique(inferredRubrique)
    setRubriqueAlert(false)
    setSaved(false)
    setApplyToGroup(false)
    setSaveModalOpened(true)
  }

  const handleSaveSubmit = () => {
    setSaved(true)
    if (onSaveControl) {
      onSaveControl({
        id: `ai-${Date.now()}`,
        name: saveForm.name,
        description: saveForm.description,
        results: saveForm.results,
        rubriqueId: saveForm.rubriqueId,
      })
    }
    setTimeout(() => {
      setSaveModalOpened(false)
      setSaved(false)
      setApplyToGroup(false)
    }, 1500)
  }

  const closeModal = () => {
    setSaveModalOpened(false)
    setApplyToGroup(false)
  }

  return {
    saveModalOpened,
    saveForm,
    setSaveForm,
    aiSuggestedRubrique,
    rubriqueAlert,
    setRubriqueAlert,
    saved,
    applyToGroup,
    setApplyToGroup,
    userRights,
    setUserRights,
    lastSuggestionIndexRef,
    handleOpenSave,
    handleSaveSubmit,
    closeModal,
  }
}
