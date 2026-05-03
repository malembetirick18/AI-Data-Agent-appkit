import { Routes, Route, Navigate } from 'react-router-dom'
import { LicenseManager as LicenseManagerAgCharts } from 'ag-charts-enterprise'
import { LicenseManager as LicenseManagerAgGrid } from 'ag-grid-enterprise'
import { AGGRID_LICENSE_KEY } from '@/config'
import { LandingPage } from './pages/LandingPage'
import { ProductPage } from './pages/ProductPage'

LicenseManagerAgCharts.setLicenseKey(AGGRID_LICENSE_KEY)
LicenseManagerAgGrid.setLicenseKey(AGGRID_LICENSE_KEY)

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/geo" element={<ProductPage product="geo" />} />
      <Route path="/closing" element={<ProductPage product="closing" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
