/**
 * Product surfaces for the AI Data Agent.
 *
 * Each product has its own Genie space (different data scope) and its own
 * theme accent. Routes open in a new browser tab from the landing page.
 */

export type Product = 'geo' | 'closing'

export const PRODUCTS: readonly Product[] = ['geo', 'closing'] as const

export const PRODUCT_LABELS: Record<Product, string> = {
  geo: 'Geoficiency',
  closing: 'Closing',
}

export const PRODUCT_ROUTES: Record<Product, string> = {
  geo: '/geo',
  closing: '/closing',
}

export const PRODUCT_GENIE_ALIAS: Record<Product, string> = {
  geo: 'geo',
  closing: 'closing',
}

export const PRODUCT_ACCENT: Record<Product, 'teal' | 'closingPink'> = {
  geo: 'teal',
  closing: 'closingPink',
}

export function isProduct(v: unknown): v is Product {
  return v === 'geo' || v === 'closing'
}
