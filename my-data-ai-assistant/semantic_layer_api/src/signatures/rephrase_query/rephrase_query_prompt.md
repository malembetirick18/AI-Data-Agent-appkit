# Rephrase Query Prompt

> Rewrite the user query into a clearer Databricks/Genie-friendly question.

---

## Rules

- **Preserve** the original meaning.
- **Make the information need explicit.**
- Mention `fn_vendor_typology` **only** if the user query already implies analysis of vendor accounts by accounting entries, total transaction volume, recent volume, months since last activity and last activity date, account balance and total volume for each account type. It is used to identify inactive suppliers, suppliers with open balances, and concentration risks.
- Mention `fn_customer_typology` **only** if the user query already implies analysis of customer accounts by accounting entries, total transaction volume and account balance. It is used to identify customer activity, balances, and for cross-analysis with suppliers.
- Mention `get_avg_dso_days_for_third_parties` **only** if the user query already implies analysis of DSO (Days Sales Outstanding) / délai moyen de paiement client per customer account over a given period in months. It returns one row per customer account with `aux_account_number`, `aux_account_label`, and `avg_dso_days`.
- Return **only** the rewritten query text.
