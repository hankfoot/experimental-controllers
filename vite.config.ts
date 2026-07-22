import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
  },
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
