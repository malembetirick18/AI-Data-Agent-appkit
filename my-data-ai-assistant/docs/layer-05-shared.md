# Couche 5 — Partagé (shared/)

**Dossier :** `shared/`  
**Fichier principal :** `shared/genui-catalog.ts`

## Responsabilités

- Définition du catalogue de composants JSON Render (schémas Zod)
- Contrats TypeScript partagés entre client et serveur
- Source de vérité pour la génération de specs GenUI côté LLM

---

## Catalogue GenUI (`chatUiCatalog`)

Définit tous les composants rendus par JSON Render. Chaque composant expose :
- `props` : schéma Zod des propriétés
- `slots` : noms des slots enfants (ex. `['default']`)
- `description` : texte utilisé dans le prompt LLM pour guider la génération

### Composants Layout

| Composant | Props | Description |
|-----------|-------|-------------|
| `Stack` | `gap?: number` | Conteneur vertical avec espacement configurable |

### Composants Texte & Listes

| Composant | Props clés | Description |
|-----------|-----------|-------------|
| `TextContent` | `content, weight?, size?, c?` | Texte avec mise en forme |
| `BulletList` | `items: string[]` | Liste à puces |

### Composants Données

| Composant | Props clés | Description |
|-----------|-----------|-------------|
| `DataTable` | `headers, rows, caption?` | Tableau statique avec en-têtes |
| `QueryDataTable` | `queryKey, parameters?, filterColumn?, pageSize?` | Tableau piloté par requête (Databricks Analytics plugin) |

### Composants Graphiques

Tous les graphiques utilisent `data: Array<Record<string, string | number>>`.

| Composant | Props spécifiques | Usage |
|-----------|------------------|-------|
| `LineChartViz` | `xKey, series[]{yKey,yName,stroke?}, yLabel?, source?` | Séries temporelles multi-métriques |
| `BarChartViz` | `xKey, yKey, color?` | Comparaison catégorielle (1 série) |
| `AreaChartViz` | `xKey, series[]{yKey,yName,stroke?}, yLabel?, source?` | Tendances avec remplissage |
| `PieChartViz` | `angleKey, labelKey` | Répartition partie/tout |
| `DonutChartViz` | `angleKey, labelKey` | Répartition avec centre libre |
| `RadarChartViz` | `angleKey, radiusKey` | Vue multivariée (max 10 catégories) |
| `BubbleChartViz` | `xKey, yKey, sizeKey` | Corrélation 3D |

### Composants Formulaires

| Composant | Props clés | Description |
|-----------|-----------|-------------|
| `FormPanel` | `title?, description?` | Conteneur de formulaire |
| `SelectInputField` | `label, options[]{value,label}, value?, required?` | Sélection catégorielle |
| `TextInputField` | `label, placeholder?, value?, required?` | Saisie texte libre |
| `NumberInputField` | `label, min?, max?, step?, value?, required?` | Saisie numérique avec bornes |
| `ToggleField` | `label, description?, checked?` | Interrupteur booléen |
| `WorkflowRuleBuilder` | `fields[], operators?, rules[]` | Constructeur de règles conditionnelles |

---

## Utilisation du catalogue dans le prompt LLM

Le fichier `semantic_layer_api/catalogs/genui_catalog_prompt.txt` est le **system prompt** du LLM GenUI. Il contient :

1. La liste des composants disponibles avec leurs props
2. Les règles de génération de specs (RFC 6902 JSONL)
3. Des exemples pour chaque type de composant
4. Les contraintes sur l'utilisation des graphiques (quel type pour quel cas)

---

## Structure d'une spec GenUI

```json
{
  "root": "stack-1",
  "elements": {
    "stack-1": {
      "component": "Stack",
      "props": { "gap": 8 },
      "slots": { "default": ["chart-1", "text-1"] }
    },
    "chart-1": {
      "component": "LineChartViz",
      "props": {
        "title": "Évolution CA mensuel",
        "data": [...],
        "xKey": "mois",
        "series": [
          { "yKey": "ca", "yName": "Chiffre d'affaires" },
          { "yKey": "objectif", "yName": "Objectif" }
        ]
      },
      "slots": {}
    },
    "text-1": {
      "component": "TextContent",
      "props": { "content": "Le CA progresse de 12% sur la période." },
      "slots": {}
    }
  },
  "state": {}
}
```

### RFC 6902 JSONL (format de génération)

Le LLM produit des opérations `add` ligne par ligne :

```jsonl
{"op":"add","path":"/root","value":"stack-1"}
{"op":"add","path":"/elements/stack-1","value":{"component":"Stack","props":{"gap":8},"slots":{"default":["chart-1"]}}}
{"op":"add","path":"/elements/chart-1","value":{"component":"LineChartViz","props":{...},"slots":{}}}
```

---

## Règles de sélection des graphiques (LLM)

| Situation | Type recommandé |
|-----------|----------------|
| Données temporelles, tendances | `LineChartViz` ou `AreaChartViz` |
| Comparaison de catégories | `BarChartViz` |
| Répartition (% du total) | `PieChartViz` ou `DonutChartViz` |
| Comparaison multivariée | `RadarChartViz` (max 10 catégories) |
| Corrélation avec taille | `BubbleChartViz` |
| Données brutes ou mixtes | `DataTable` |
| Données paginées (warehouse) | `QueryDataTable` |
