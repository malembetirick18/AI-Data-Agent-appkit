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
| `POST` | `/chat/stream` | Pipeline contrôleur → SSE `event: controller_decision` |
| `POST` | `/spec/generate` | Génération spec GenUI → SSE `event: spec` |

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
            _validate_against_catalog() → supprime les hallucinations
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

---

## Génération de specs GenUI

Module : `src/genui_spec_generator.py`  
Signature : `src/signatures/genui_spec_signature.py`

Le LLM génère du **JSONL RFC 6902** (une opération `add` par ligne). L'assembleur `_assemble_spec_from_patches()` reconstruit le dictionnaire `{ root, elements, state }`.

Fallback : si le LLM produit un JSON objet au lieu de JSONL, il est accepté directement si `root` et `elements` sont présents.

### Endpoint `/spec/generate` — async (important)

L'endpoint est `async def generate_spec(...)` avec `result = await asyncio.to_thread(_run_genui)`. **Ne jamais le repasser en `def` synchrone.** Un handler synchrone bloquerait un worker du threadpool FastAPI pendant toute la durée de l'appel DSPy (10–30s), épuisant le pool sous charge concurrente. Le sibling `/chat/stream` utilise le même pattern.

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

---

## Signatures DSPy — fichiers de référence

| Fichier | Phase | Rôle |
|---------|-------|------|
| `signatures/query_analysis_signature.py` | Phase 1 | Classification + cohérence |
| `signatures/rephrase_query_signature.py` | Phase 2 | Réécriture conditionnelle |
| `signatures/controller_decision_signature.py` | Phase 3 | Décision contrôleur |
| `signatures/controller_self_reflection_signature.py` | Phase 3c | Auto-réflexion LLM — diagnostic verbal (POURQUOI c'est faux) |
| `signatures/controller_correction_signature.py` | Phase 4 | Correcteur LLM — applique validation_feedback + self_reflection_text |
| `signatures/genui_spec_signature.py` | Spec | Génération JSONL patches |
| `signatures/reasoning_summary_signature.py` | — | Résumé de raisonnement (support interne au pipeline) |

### Fichiers legacy (non utilisés — peuvent être supprimés)

| Fichier | Remplacé par |
|---------|-------------|
| `signatures/query_classification_signature.py` | `QueryAnalysisSignature` (Phase 1) |
| `signatures/required_columns_signature.py` | `QueryAnalysisSignature` (Phase 1) |
| `signatures/sql_function_signature.py` | `QueryAnalysisSignature` (Phase 1) |

---

## Logging

La classe `Logger` (`src/logger.py`) est un wrapper de `logging.Logger` avec :
- Handler `StreamHandler` (stdout)
- Handler `FileHandler` optionnel
- Format : `%(asctime)s - %(name)s - %(levelname)s - %(message)s`

Instance dans `controller_decision.py` : `_logger = Logger("controller-decision")`
Instance dans `main.py` : `logger = Logger()` (nom par défaut : `"semantic-layer-api"`)
