// French finance/audit mock fixtures — swap for real props.

export type Fournisseur = {
  id: string; nom: string; categorie: string;
  ca2024: number; ca2025: number; variation: number;
  ecart: 'élevé' | 'normal' | 'inactif';
  risque: 'high' | 'medium' | 'low';
  region: string; factures: number; doublons: number;
};

export type ConversationSnippet = {
  id: string; speaker: string; timestamp: string;
  quote: string; source: string; tags: string[];
};

export const SUGGESTED_PROMPTS = [
  "Les variations de dépenses par fournisseur ou catégorie sont-elles cohérentes avec les tendances historiques et les volumes d'activité ?",
  "Existe-t-il des transactions d'achats présentant des montants, fréquences ou dates atypiques (ex. fractionnement de factures, achats en fin de période, doublons potentiels) ?",
  "Des fournisseurs inactifs continuent-ils à être réglés ?",
  "Quels tiers ont une activité à la fois fournisseur et client ?",
  "Y a-t-il des écarts significatifs entre les soldes comptables fournisseurs et les balances auxiliaires ?",
];

export const FOURNISSEURS: Fournisseur[] = [
  { id: 'F-1042', nom: 'Logistique Voltaire SAS', categorie: 'Transport', ca2024: 1248500, ca2025: 1612300, variation: 29.1, ecart: 'élevé', risque: 'high', region: 'Île-de-France', factures: 142, doublons: 3 },
  { id: 'F-2891', nom: 'Métallurgie Roussel', categorie: 'Matières premières', ca2024: 892100, ca2025: 905200, variation: 1.5, ecart: 'normal', risque: 'low', region: 'Auvergne-Rhône-Alpes', factures: 87, doublons: 0 },
  { id: 'F-3317', nom: 'Numéris Conseil', categorie: 'Prestations IT', ca2024: 412000, ca2025: 689400, variation: 67.3, ecart: 'élevé', risque: 'high', region: 'Île-de-France', factures: 54, doublons: 1 },
  { id: 'F-4720', nom: 'Atelier Lemoine', categorie: 'Maintenance', ca2024: 178200, ca2025: 191500, variation: 7.4, ecart: 'normal', risque: 'low', region: 'Hauts-de-France', factures: 38, doublons: 0 },
  { id: 'F-5103', nom: 'Cabinet Arènes', categorie: 'Conseil juridique', ca2024: 220000, ca2025: 358700, variation: 63.0, ecart: 'élevé', risque: 'medium', region: 'Provence-Alpes-Côte d\'Azur', factures: 22, doublons: 0 },
  { id: 'F-5821', nom: 'Imprimerie Quentin', categorie: 'Fournitures', ca2024: 64300, ca2025: 9800, variation: -84.7, ecart: 'inactif', risque: 'medium', region: 'Bretagne', factures: 6, doublons: 0 },
  { id: 'F-6402', nom: 'TransExpress Méditerranée', categorie: 'Transport', ca2024: 305800, ca2025: 412600, variation: 34.9, ecart: 'élevé', risque: 'medium', region: 'Occitanie', factures: 71, doublons: 2 },
  { id: 'F-7158', nom: 'Énergie Plus Distribution', categorie: 'Énergie', ca2024: 1102400, ca2025: 1138900, variation: 3.3, ecart: 'normal', risque: 'low', region: 'Grand Est', factures: 24, doublons: 0 },
];

export const CONVERSATION_SNIPPETS: ConversationSnippet[] = [
  { id: 'C-1', speaker: 'Direction Achats', timestamp: '2026-04-12 · 14:32',
    quote: "On a renouvelé le contrat avec Numéris Conseil sur Q1 — l'enveloppe est passée à 180k€ par trimestre. C'est validé par Mme Renaud.",
    source: 'Réunion Comité Achats', tags: ['contrat', 'Numéris Conseil', 'budget'] },
  { id: 'C-2', speaker: 'Contrôle de gestion', timestamp: '2026-03-28 · 09:15',
    quote: "Logistique Voltaire facture en double sur février — on a vu trois factures avec le même bon de livraison. À investiguer en priorité.",
    source: 'Email — alerte', tags: ['doublon', 'Logistique Voltaire', 'risque'] },
  { id: 'C-3', speaker: 'Comptabilité fournisseurs', timestamp: '2026-04-02 · 16:48',
    quote: "Imprimerie Quentin n'a quasi plus d'activité depuis Q4 2024. On peut le passer en inactif après vérification du dernier règlement.",
    source: 'Note interne', tags: ['inactif', 'Imprimerie Quentin'] },
];

export const CONTROL_RESPONSE_PARAS = [
  "**Synthèse.** Sur les 8 fournisseurs analysés représentant **5,32 M€ de CA 2025**, l'agent identifie **3 cas d'écart significatif** (>25 % vs. année précédente) et **1 fournisseur inactif** continuant à être réglé. Les écarts sont concentrés sur les catégories **Transport** et **Prestations IT**.",
  "**Variations atypiques.** *Logistique Voltaire SAS* (+29,1 %), *Numéris Conseil* (+67,3 %) et *Cabinet Arènes* (+63,0 %) présentent des hausses non corrélées au volume d'activité observé. Conversations achats valident le renouvellement Numéris (cf. évidence C-1).",
  "**Doublons potentiels.** 6 factures détectées avec mêmes montants et bons de livraison sur 2 fournisseurs (*Logistique Voltaire*, *TransExpress Méditerranée*). Cf. évidence C-2.",
  "**Recommandations.** Demander justificatifs Numéris, ouvrir un contrôle ciblé Logistique Voltaire (priorité haute), proposer la désactivation d'*Imprimerie Quentin* (cf. C-3).",
];

export const fmtCA = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
