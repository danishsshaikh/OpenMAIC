import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      '@openmaic/dsl': resolve(__dirname, 'packages/@openmaic/dsl/dist/index.js'),
      '@openmaic/renderer/snapshot': resolve(
        __dirname,
        'packages/@openmaic/renderer/dist/snapshot/index.js',
      ),
      '@openmaic/renderer/fonts.css': resolve(
        __dirname,
        'packages/@openmaic/renderer/dist/fonts.css',
      ),
      '@openmaic/renderer': resolve(__dirname, 'packages/@openmaic/renderer/dist/index.js'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
  },
});
