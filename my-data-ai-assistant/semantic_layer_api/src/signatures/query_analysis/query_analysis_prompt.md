# Query Analysis Signature Prompt

> Analyze a user query for Databricks workloads in one step.

---

## 1. Classification

Return exactly one of:

| Value | Description |
|---|---|
| `Normal SQL` | Standard SQL query |
| `SQL Function` | Queries involving `fn_vendor_typology`, `fn_customer_typology`, `get_tva_rates_by_folder_id`, `get_tva_rates_applied_for_customers_by_folder_id`, `get_tva_rates_applied_for_suppliers_by_folder_id`, or `get_avg_dso_days_for_third_parties`, including any mention of inactive suppliers/customers, vendor/customer typology, concentration risk, activity analysis, supplier/customer balances by account type, TVA/VAT rate analysis, or DSO (Days Sales Outstanding) / délai de paiement client analysis |
| `Predictive SQL` | Queries with predictive or ML components |
| `General Information` | Non-SQL informational requests |

---

## 2. Required Columns

Return **ONLY** a JSON array of column names (no table names).

---

## 3. SQL Functions

Return **ONLY** a JSON array using these allowed values:

```json
["fn_vendor_typology", "fn_customer_typology", "get_tva_rates_by_folder_id", "get_tva_rates_applied_for_customers_by_folder_id", "get_tva_rates_applied_for_suppliers_by_folder_id", "get_avg_dso_days_for_third_parties"]
```

| Function | When to use |
|---|---|
| `fn_customer_typology` | Customer activity, inactive customers, customer balances, concentration risk |
| `fn_vendor_typology` | Supplier activity, inactive suppliers, supplier balances, concentration risk |
| `get_tva_rates_by_folder_id` | All distinct TVA/VAT rates (deductible + collected) for a folder |
| `get_tva_rates_applied_for_customers_by_folder_id` | Distinct collected TVA rates for customer entries |
| `get_tva_rates_applied_for_suppliers_by_folder_id` | Distinct deductible TVA rates for supplier entries |
| `get_avg_dso_days_for_third_parties` | Average DSO (Days Sales Outstanding / délai moyen de paiement client) per customer account over a given period |

Return `[]` if none apply.

---

## 4. Coherence Note

Analyse the semantic coherence of the query:

### Step 1 — Identify apparent contradictions
(e.g. "inactive supplier + still paid")

### Step 2 — Classify each contradiction

**(a) AUDIT_PATTERN** — The contradiction IS the anomaly being detected (e.g. inactive supplier receiving payments = potential fraud indicator). Mark as `AUDIT_PATTERN`.

**(b) INCOHERENT** — The question cannot logically be answered. Mark as `INCOHERENT`.

### Step 3 — Identify polysemous accounting terms

Key terms that have multiple incompatible interpretations in accounting context that would produce fundamentally different SQL:

| Term | Possible interpretations |
|---|---|
| `"inactif"` | no entries vs no invoices/orders vs master file status |
| `"solde anormal"` / `"solde créditeur anormal"` / `"solde débiteur anormal"` | even when direction (créditeur/débiteur) is specified, "anormal" still requires a numeric threshold |
| `"doublon"` | same amount+date vs same invoice ref vs same supplier+amount |
| `"récent"` / `"dernièrement"` | no absolute date given |
| `"transaction atypique"` / `"écriture atypique"` / `"écriture suspecte"` | outlier by amount vs frequency vs counterpart |
| `"tiers actif fournisseur et client"` | same SIREN vs same account vs same name |

### Step 4 — Flag PARAMETRIC

Flag `PARAMETRIC` when a query's intent is clear but a required numeric parameter is missing.

Examples:
- "soldes créditeurs anormaux" without a threshold amount
- "retards importants" without a number of days
- "écarts significatifs" without a tolerance percentage
- "tiers inactifs depuis longtemps" without an inactivity period
- "factures avec écart significatif" without a tolerance percentage

Format: `PARAMETRIC: <missing parameter description>`

### Output

Return a concise note describing any findings. Return an **empty string** if the query is unambiguous, has no apparent contradictions, and all required parameters are present.
