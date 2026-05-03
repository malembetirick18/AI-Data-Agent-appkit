import type { Product } from '../../../shared/products'

export type FolderRow = {
  spFolderId: string
  sessionId: string
  description: string
}

export type SelectedFolder = {
  spFolderId: string
  sessionId: string
}

export const FOLDER_EXAMPLES: Record<Product, FolderRow[]> = {
  geo: [
    {
      spFolderId: '3kmctw701a4k',
      sessionId: '3kmctw701a4k.001.001',
      description: 'Très grand volume (2,7M éc., 19,3Md€). Charges/produits déséquilibrés (−19M€). Créances 13,3M€, dettes fournisseurs 11,6M€',
    },
    {
      spFolderId: '363-ww3sul04',
      sessionId: '363-ww3sul04.001.001',
      description: 'Volume maximal de la sélection (3,1M éc., 9,2Md€). Déficit charges/produits de 78M€. Trésorerie 3,3M€',
    },
    {
      spFolderId: 'gycljhw7er5j',
      sessionId: 'gycljhw7er5j.002.001',
      description: 'Dossier équilibré (balance nulle, 938M€). Bonne trésorerie (7,7M€). Solde clients légèrement négatif (−847K€)',
    },
    {
      spFolderId: '_-ysf6w13v-_',
      sessionId: '_-ysf6w13v-_.001.002',
      description: 'Session antérieure — balance nulle, 893M€. Trésorerie 7,4M€, solde clients déficitaire (−2,4M€) à surveiller',
    },
    {
      spFolderId: '_-ysf6w13v-_',
      sessionId: '_-ysf6w13v-_.002.001',
      description: 'Session courante (données identiques) — balance nulle, trésorerie 7,4M€, solde clients négatif (−2,4M€)',
    },
    {
      spFolderId: 'cqu5q5tr1515',
      sessionId: 'cqu5q5tr1515.001.001',
      description: 'Volume intermédiaire (338K éc., 712M€). Charges > produits (−4,6M€). Trésorerie tendue (181K€), créances 1,5M€',
    },
    {
      spFolderId: 'asdsgtk42ev1',
      sessionId: 'asdsgtk42ev1.001.001',
      description: 'Dossier sain : balance nulle, produits > charges. Trésorerie solide (8,3M€), créances clients positives (6,6M€)',
    },
    {
      spFolderId: '0n9-nkbhgu2m',
      sessionId: '0n9-nkbhgu2m.002.001',
      description: 'Structure identique à asdsgtk42ev1 (461M€, 70,5K éc.). Bonne trésorerie (8,3M€), créances saines (6,6M€)',
    },
    {
      spFolderId: '6nwb-fzvzy5q',
      sessionId: '6nwb-fzvzy5q.001.001',
      description: 'Profil équilibré (451M€, 70,5K éc., balance nulle). Trésorerie 8,3M€, produits légèrement > charges',
    },
    {
      spFolderId: 'dvod1w6pp0-7',
      sessionId: 'dvod1w6pp0-7.001.002',
      description: 'Données proches de 6nwb-fzvzy5q (451M€, balance nulle). Trésorerie saine (8,3M€), faible dette fournisseurs',
    },
    {
      spFolderId: 'nlkl09pl86l5',
      sessionId: 'nlkl09pl86l5.001.001',
      description: 'Petit dossier (149M€, 69K éc.). Trésorerie quasi nulle (370€) — risque liquidité. Charges > produits, créances 746K€',
    },
  ],
  closing: [
    {
      spFolderId: '_sj5lh47d_s5',
      sessionId: '_sj5lh47d_s5.001.001',
      description: 'Grand dossier de clôture (3,47Md€, 142K écritures, 422 comptes). Balance parfaite. Volume de lignes très élevé (847K)',
    },
    {
      spFolderId: 'chg5bc9pr-_7',
      sessionId: 'chg5bc9pr-_7.001.001',
      description: 'Dossier mid-size (451M€, 148K écritures, 427 comptes). Balance parfaitement équilibrée, 298K lignes comptables',
    },
    {
      spFolderId: 'ge20lgndwdef',
      sessionId: 'ge20lgndwdef.001.001',
      description: 'Structure proche de _sj5lh47d_s5 (3,47Md€, 142K écritures, 422 comptes). Balance nulle, 847K lignes',
    },
    {
      spFolderId: 'jn79v041g0xo',
      sessionId: 'jn79v041g0xo.001.001',
      description: 'Première session du dossier (382M€, 123K écritures, 421 comptes). Balance nulle, volume modéré (248K lignes)',
    },
    {
      spFolderId: 'jn79v041g0xo',
      sessionId: 'jn79v041g0xo.002.001',
      description: 'Session 2 — données identiques à .001.001 (382M€, 123K écritures). Balance nulle, 248K lignes',
    },
    {
      spFolderId: 'jn79v041g0xo',
      sessionId: 'jn79v041g0xo.003.001',
      description: 'Session 3 — périmètre étendu (461M€ vs 382M€, +25K écritures). Balance nulle, 427 comptes',
    },
    {
      spFolderId: 'jn79v041g0xo',
      sessionId: 'jn79v041g0xo.004.001',
      description: 'Session 4 — périmètre stable (461M€, 148K écritures, 427 comptes). Balance nulle, 298K lignes',
    },
    {
      spFolderId: 'jn79v041g0xo',
      sessionId: 'jn79v041g0xo.005.001',
      description: 'Session 5 — données stables depuis la session 3 (461M€, 148K écritures). Balance nulle',
    },
    {
      spFolderId: 'jn79v041g0xo',
      sessionId: 'jn79v041g0xo.006.001',
      description: 'Session 6 — flux inchangés (461M€, 148K écritures, 427 comptes). Balance parfaitement nulle',
    },
    {
      spFolderId: 'jn79v041g0xo',
      sessionId: 'jn79v041g0xo.007.001',
      description: 'Session 7 — structure identique aux sessions 3–6 (461M€, 148K écritures). Balance nulle',
    },
    {
      spFolderId: 'jn79v041g0xo',
      sessionId: 'jn79v041g0xo.008.001',
      description: 'Dernière session disponible (461M€, 148K écritures, 427 comptes). Balance nulle, 298K lignes comptables',
    },
    {
      spFolderId: 'xedhgxknhtia',
      sessionId: 'xedhgxknhtia.001.001',
      description: 'Grand dossier (3,47Md€, 142K écritures, 422 comptes). Même structure que le groupe supérieur. Balance nulle',
    },
    {
      spFolderId: 'xedhgxknhtia',
      sessionId: 'xedhgxknhtia.001.002',
      description: 'Session secondaire (données identiques à .001.001) — 3,47Md€, 142K écritures, balance nulle',
    },
    {
      spFolderId: 'xo45cdm__6pv',
      sessionId: 'xo45cdm__6pv.001.001',
      description: 'Session initiale (414M€, 135K écritures, 419 comptes). Balance nulle, volume intermédiaire (273K lignes)',
    },
    {
      spFolderId: 'xo45cdm__6pv',
      sessionId: 'xo45cdm__6pv.002.001',
      description: 'Session étendue (451M€ vs 414M€, +13K écritures, 424 comptes). Balance nulle, périmètre comptable agrandi',
    },
    {
      spFolderId: 'y_-31eour425',
      sessionId: 'y_-31eour425.001.001',
      description: 'Dossier mid-size (451M€, 148K écritures, 424 comptes). Balance équilibrée, même strate que chg5bc9pr-_7',
    },
    {
      spFolderId: 'zpbwf8kvmha4',
      sessionId: 'zpbwf8kvmha4.001.001',
      description: 'Grand dossier de clôture (3,47Md€, 142K écritures, 422 comptes). Balance nulle, groupe des dossiers 3Md€+',
    },
  ],
}
