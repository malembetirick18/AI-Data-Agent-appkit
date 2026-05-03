import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    passWithNoTests: true,
    globals: true,
    environment: 'node',
    setupFiles: ['./client/src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.spec.ts', '**/.smoke-test/**', '**/.databricks/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
    },
  },
});
