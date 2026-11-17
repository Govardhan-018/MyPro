import { defineConfig } from 'vitest/config';

// `.mts` so Vite loads this ESM config natively (the package is CommonJS, so a
// `.ts` config triggers a configLoader deprecation warning). Tests live in
// test/ (not src/) to stay out of the Nest build and `tsc --noEmit`, which
// include src only.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
