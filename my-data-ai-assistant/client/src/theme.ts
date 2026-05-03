import { createTheme, type MantineColorsTuple } from '@mantine/core'

const teal: MantineColorsTuple = [
  '#e6f7f5',
  '#c9ece8',
  '#9bdcd5',
  '#5fc3b8',
  '#2ba99c',
  '#1ba098',
  '#0f8a82',
  '#0a6f68',
  '#074f4a',
  '#053632',
]

const closingPink: MantineColorsTuple = [
  '#fdeaf3',
  '#fbd0e3',
  '#f7a3c8',
  '#ef6ba9',
  '#e63d8e',
  '#d72178',
  '#b81763',
  '#911150',
  '#5f0a35',
  '#3d0824',
]

export const theme = createTheme({
  primaryColor: 'teal',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  defaultRadius: 'md',
  colors: { teal, closingPink },
})
