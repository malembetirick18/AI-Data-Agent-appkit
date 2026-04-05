# Couche 3 — API Sémantique (FastAPI / DSPy / Python)

**Dossier :** `semantic_layer_api/`  
**Point d'entrée :** `semantic_layer_api/main.py`

## Responsabilités

- Pipeline de décision contrôleur multi-étapes (DSPy agents)
- Génération de spécifications GenUI (RFC 6902 JSONL)
- Traçage MLflow des appels LLM
- Validation programmatique du catalogue Genie

---

## Endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/health` | Healthcheck |
| `POST` | `/chat/stream` | Pipeline contrôleur → SSE (`event: status`, `event: reasoning_token`, `event: controller_decision`) |
| `POST` | `/spec/generate` | Génération spec GenUI → JSONL stream (patches + `# status` comments) |

### Streaming architecture (FastAPI ≥ 0.134 + DSPy `streamify`)

Both endpoints use the native FastAPI `yield` pattern:

```python
@app.post("/chat/stream", response_class=StreamingResponse)
async def stream_chat(request: ControllerRequest) -> AsyncIterable[str]:
    async for chunk in _stream_controller(...):
        if isinstance(chunk, StatusMessage):
            yield f"event: status\ndata: ...\n\n"
        elif isinstance(chunk, StreamResponse):
            yield f"event: reasoning_token\ndata: ...\n\n"
        elif isinstance(chunk, dspy.Prediction):
            yield f"event: controller_decision\ndata: ...\n\n"
```

References:
- https://fastapi.tiangolo.com/advanced/stream-data/
- https://github.com/stanfordnlp/dspy/blob/main/docs/docs/tutorials/streaming/index.md

**Key invariants:**
- No manual `StreamingResponse(generator)` wrapping — `response_class=StreamingResponse` + `yield` is sufficient.
- `dspy.streamify()` wraps both `controller_agent` and `genui_spec_generator` at startup.
- `StatusMessageProvider` subclasses (`ControllerStatusProvider`, `SpecStatusProvider`) provide human-readable progress updates.
- `StreamListener(signature_field_name=...)` selects which output field to stream token-by-token.
- Both LM instances (`lm`, `genui_lm`) share `_LM_KWARGS` — do not duplicate Azure config.

---

## Pipeline `ControllerDecision` (4 phases)

Fichier : `src/controller_decision.py`

**Pattern : Reflexion complet (Shinn et al., 2023) — Acteur → Évaluateur → Auto-réflexion → Correcteur**

```
Phase 1 ── QueryAnalysisSignature  [ACTEUR — 1 appel LLM]
           Entrées : prompt, catalog_info
           Sorties : classification, required_columns_json,
                     sql_functions_json, coherence_note

Phase 2 ── RephraseQuerySignature  [ACTEUR — conditionnel]
           Déclenché si classification ≠ "Normal SQL"
           Sorties : rewritten_prompt

Phase 3 ── ControllerDecisionSignature  [ACTEUR — 1 appel LLM]
           Entrées : toutes les sorties précédentes
           Sorties : decision_json (proceed|guide|clarify|error)

Phase 3b ── Évaluateur programmatique  [ÉVALUATEUR — coût zéro]
            _build_catalog_index() → index tables/colonnes/fonctions
            _validate_against_catalog(phase3_confidence) → supprime les hallucinations
              ↳ si phase3_confidence ≥ _HIGH_CONFIDENCE_THRESHOLD (0.85)
                et que le strip viderait suggestedTables → strip ignoré (LLM de confiance)
            _build_validation_feedback() → feedback textuel (QUOI est faux)

Phase 3c ── ControllerSelfReflectionSignature  [AUTO-RÉFLEXION — conditionnel]
            Actif si ENABLE_CONTROLLER_REFLECTION=true
            ET decision ∈ {proceed, guide}
            Entrée : original_decision_json + validation_feedback
            Sortie : self_reflection_text (POURQUOI c'est faux + QUE changer)
            → Diagnostic verbal transmis au Correcteur

Phase 4 ── ControllerCorrectionSignature  [CORRECTEUR / ACTEUR retry — conditionnel]
           Entrées : original_decision_json + validation_feedback + self_reflection_text
           Sorties : corrected_decision_json
           → Phase 3b rejoue sur la sortie corrigée (boucle fermée)

Guardrail scope (toujours exécuté après Phase 4)
           Si scope non établi → force clarify + 3 questions scope
```

### Rôles Reflexion dans ce pipeline

| Rôle Reflexion | Phase ici | Implémentation |
|----------------|-----------|---------------|
| **Acteur** | 1, 2, 3 | DSPy `ChainOfThought` sur chaque signature |
| **Évaluateur** | 3b | `_validate_against_catalog()` — programmatique, déterministe |
| **Auto-réflexion** | 3c | `ControllerSelfReflectionSignature` — LLM explique POURQUOI |
| **Acteur (retry)** | 4 | `ControllerCorrectionSignature` — LLM corrige avec les deux signaux |

> **Différence avec le papier original :**  
> Reflexion original accumule les réflexions en mémoire sur plusieurs essais successifs.
> Ici une seule passe de réflexion+correction est effectuée par requête (contrainte de latence
> synchrone). L'évaluateur est programmatique (déterministe) plutôt que LLM-based.
> Ces adaptations préservent les bénéfices principaux (diagnostic verbal explicite → meilleure
> correction) tout en restant compatibles avec un contexte API synchrone.

### Classification des requêtes

| Classification | Déclencheurs |
|---------------|-------------|
| `Normal SQL` | Requête SQL directe et non ambiguë |
| `SQL Function` | Implique `fn_vendor_typology` ou `fn_customer_typology` |
| `Predictive SQL` | Analyse prédictive ou statistique |
| `General Information` | Question informationnelle non-SQL |

### Analyse de cohérence (`coherence_note`)

| Code | Signification | Action contrôleur |
|------|---------------|-------------------|
| `AUDIT_PATTERN` | Contradiction valide = indicateur de fraude | `clarify` si terme polysémique associé |
| `POLYSEMOUS` | Terme à interprétations multiples (ex: "inactif") | Toujours `clarify` |
| `PARAMETRIC` | Seuil numérique manquant | `clarify` avec `needsParams: true` |
| `INCOHERENT` | Requête logiquement impossible | `error` |
| *(vide)* | Requête non ambiguë et complète | Continuer normalement |

### Règles de scoring de confiance

| Décision | Plage de confiance |
|----------|--------------------|
| `proceed` (clair) | ≥ 0.90 |
| `proceed` (hypothèses) | 0.70 – 0.89 |
| `guide` | 0.40 – 0.69 |
| `clarify` | 0.10 – 0.39 |
| `error` | 0.00 |

**Pénalité hallucination :** si des noms hallucinations sont détectés lors d'une décision `proceed`, la confiance est plafonnée à `min(conf, 0.75)`.

> **Heuristique haute confiance (`_HIGH_CONFIDENCE_THRESHOLD = 0.85`) :** si Phase-3 renvoie une confiance ≥ 0.85 et que le nettoyage viderait entièrement `suggestedTables`, le strip est ignoré — le LLM est jugé suffisamment certain pour que le catalogue (potentiellement incomplet) ne l'emporte pas. Les pénalités Rule 1 et Rule 2 s'appliquent normalement en dessous de ce seuil.

---

## Guardrail de périmètre (scope)

Vérification **programmatique** (non-LLM) exécutée après toutes les phases LLM.

**Mots-clés détectés :** `groupe`, `filiale`, `sp_folder_id`, `group`, `subsidiary`

Si aucun de ces mots-clés n'est présent dans le prompt ou le contexte de conversation, le pipeline **force** :
- `decision = "clarify"`
- Insertion de 3 questions de périmètre en tête de `questions[]`
- `confidence = min(conf, 0.35)`

### Questions de périmètre injectées

```python
_SCOPE_QUESTIONS = [
    { "id": "scope_level",  "inputType": "select",  "required": True,
      "options": [{"value":"group"}, {"value":"filiale"}] },
    { "id": "sp_folder_id", "inputType": "text",    "required": False },
    { "id": "row_limit",    "inputType": "number",  "min": 1, "max": 1000 },
]
```

---

## Cycle Reflexion : Auto-réflexion (3c) + Correction (4)

Signature DSPy implémentant le pattern **Reflexion** (LLM auto-correction sur signal évaluateur).

### Règles de correction (dans l'ordre)

1. Accepter les suppressions de noms du `validation_feedback` — ne pas les ré-ajouter
2. Si `suggestedTables` vide après nettoyage et `decision='proceed'` → rétrograder en `guide`
3. `POLYSEMOUS` dans `coherence_note` → forcer `clarify`  
   `AUDIT_PATTERN` seul (sans `POLYSEMOUS`) → ne **pas** forcer `clarify` (finding d'audit valide)  
   `AUDIT_PATTERN` **ET** `POLYSEMOUS` → forcer `clarify` (terme polysémique rend le SQL indéterminé)
4. `PARAMETRIC` dans `coherence_note` → forcer `clarify` avec `needsParams: true`
5. Recalibrer la confiance selon les plages exactes du contrôleur primaire :
   - `proceed` clair ≥ 0.90 / `proceed` hypothèses : 0.70–0.89
   - `guide` : 0.40–0.69 / `clarify` : 0.10–0.39 / `error` : 0.0
6. Ne pas modifier `rewrittenPrompt`, `queryClassification`, `coherenceNote`, `questions`
7. Si aucune correction nécessaire → retourner `original_decision_json` inchangé

**Activation :** `ENABLE_CONTROLLER_REFLECTION=true` — active les deux phases 3c et 4  
**Portée :** uniquement pour `proceed` et `guide` (pas `clarify`/`error` déjà conservateurs)  
**Appels LLM supplémentaires :** +2 par requête (Phase 3c + Phase 4)  
**Erreurs :** loguées en `WARNING` — non-fatales, Phase 3b conservée si le cycle échoue  
**Phase 3c** sortie loguée en `INFO` (traçabilité du diagnostic verbal)

---

## Validation catalogue (`_validate_against_catalog`)

Champs validés :

| Champ | Index utilisé |
|-------|--------------|
| `suggestedTables` | `catalog.tables[*].name` |
| `requiredColumns` | `catalog.tables[*].columns[*].name` |
| `predictiveFunctions` | `catalog.functions[*].name` |
| `suggestedFunctions` | `catalog.functions[*].name` |

### Règles de pénalité après stripping

| Condition | Effet |
|-----------|-------|
| `suggestedTables` vidé après strip **ET** `phase3_confidence < 0.85` | `decision = "clarify"`, `confidence ≤ 0.45` (Rule 1) |
| `suggestedTables` vidé après strip **ET** `phase3_confidence ≥ 0.85` | Strip ignoré — table conservée, aucune pénalité (heuristique haute confiance) |
| Autres champs hallucination, tables restantes, décision `proceed`/`guide` | `decision = "guide"`, `confidence ≤ 0.70` (Rule 2) |
| Décisions `clarify`/`error` avec hallucinations | Pas de modification supplémentaire (déjà conservateurs) |

La constante `_HIGH_CONFIDENCE_THRESHOLD = 0.85` est définie en tête de `controller_decision.py`.

---

## Génération de specs GenUI

Module : `src/modules/genui_spec_generator.py`  
Signature : `src/signatures/genui_spec/`

Le LLM génère du **JSONL RFC 6902** (une opération `add` par ligne). Le client (`useUIStream`) assemble les patches côté navigateur — aucune validation ou assemblage côté serveur.

### Schéma `SpecRequest`

```python
class SpecRequest(BaseModel):
    prompt: str
    genie_result: Union[dict, list, str, None] = None
    questions: list[dict] | None = None   # ControllerQuestion[] from client
```

Quand `questions` est fourni, `_build_spec_prompt()` sérialise les questions via `_serialize_questions()` et les ajoute au prompt LLM. Cela donne au modèle le contexte structuré pour générer un spec `FormPanel` avec les bons `$bindState` bindings, types d'inputs, et contraintes.

Format serialisé (exemple) :
```
Required user inputs — generate a FormPanel spec with $bindState bindings for each:
1. [id=scope_level, type=select (single-choice dropdown)] Périmètre (required)
   options: filiale, groupe
2. [id=sp_folder_id, type=text input] Identifiant SP (optional)
   visibility: only show when scope_level = 'filiale'
```

### Streaming `/spec/generate`

L'endpoint utilise `dspy.streamify()` avec `StreamListener(signature_field_name="spec_patches")` pour émettre les tokens au fil de l'eau.

| Type de chunk | Format émis | Consommation client |
|---------------|-------------|--------------------|
| `StatusMessage` | `# Generating UI spec…\n` (commentaire JSONL) | Ignoré par les parsers JSONL, affiché par les clients compatibles |
| `StreamResponse` | Token partiel (non-JSONL complet) | Non émis — seule la `Prediction` est autoritative |
| `Prediction` | Lignes JSONL complètes (`{"op":"add",...}\n`) | `useUIStream` assemble les patches en spec |

**Invariants :**
- Pas de `_parse_patches`, `_assemble_spec_from_patches`, ni de couche de validation côté serveur. Ne pas les ré-ajouter.
- Pas de fallback JSON objet — seul le format JSONL patches est supporté.
- Le `developer_prompt` (catalogue GenUI) est passé via l'input DSPy, pas via `system_prompt` du LM.
- Le fallback si `/spec/generate` échoue est **côté client uniquement** (`questionsToSpec()` dans `lib/clarification-spec.ts`) — ne pas ajouter de génération de spec déterministe côté Python.

### Endpoint `/spec/generate` — async streaming (important)

L'endpoint est `async def generate_spec(...)` avec `async for chunk in stream_spec(...)`. Les chunks sont émis au fur et à mesure via `yield`. **Ne jamais revenir à un pattern `asyncio.to_thread` + itération post-hoc.** Le streaming temps réel permet au client de commencer l'assemblage avant la fin de la génération LLM.

---

## Configuration

| Variable d'environnement | Description |
|--------------------------|-------------|
| `AZURE_API_KEY` | Clé Azure OpenAI |
| `AZURE_API_BASE` | Base URL Azure OpenAI |
| `ENABLE_CONTROLLER_REFLECTION` | `true` en production, `false` en dev |
| `MLFLOW_TRACKING_URI` | URI MLflow (défaut : `databricks`) |
| `MLFLOW_SEMANTIC_LAYER_TRACING_EXPERIMENT` | Nom expérience MLflow |
| `MLFLOW_LOG_TRACES` | Active le log de traces (`true`) |
| `SUGGESTIONS` | JSON array de strings pour remplacer les suggestions par défaut (optionnel) |

`SUGGESTIONS` est parsé via `json.loads()` avec `try/except (json.JSONDecodeError, ValueError)` — un JSON invalide log un warning et tombe sur `DEFAULT_SUGGESTIONS`.

---

## Signatures DSPy — fichiers de référence

Chaque signature vit dans son propre sous-dossier `signatures/<name>/` avec la classe DSPy et son fichier de prompt développeur.

| Dossier | Phase | Rôle |
|---------|-------|------|
| `signatures/query_analysis/` | Phase 1 | Classification + cohérence |
| `signatures/rephrase_query/` | Phase 2 | Réécriture conditionnelle |
| `signatures/controller_decision/` | Phase 3 | Décision contrôleur |
| `signatures/controller_self_reflection/` | Phase 3c | Auto-réflexion LLM — diagnostic verbal (POURQUOI c'est faux) |
| `signatures/controller_correction/` | Phase 4 | Correcteur LLM — applique validation_feedback + self_reflection_text |
| `signatures/genui_spec/` | Spec | Génération JSONL patches + catalogue 20 composants |
| `signatures/reasoning_summary/` | — | Résumé de raisonnement (support interne au pipeline) |
| `signatures/utils/` | — | `prompt_utils.py` — chargement des prompts développeur depuis fichiers |

Les modules DSPy (pipeline complet) sont dans `src/modules/` :
- `modules/controller_decision.py` — pipeline Reflexion 4 phases
- `modules/genui_spec_generator.py` — génération spec GenUI avec error handling

---

## Logging

La classe `Logger` (`src/logger.py`) est un wrapper de `logging.Logger` avec :
- Handler `StreamHandler` (stdout)
- Handler `FileHandler` optionnel
- Format : `%(asctime)s - %(name)s - %(levelname)s - %(message)s`

Instance dans `controller_decision.py` : `logger = Logger("controller-decision")`
Instance dans `main.py` : `logger = Logger()` (nom par défaut : `"semantic-layer-api"`)
