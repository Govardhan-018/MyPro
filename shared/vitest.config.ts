import { defineConfig } from 'vitest/config';

// Pure, platform-free logic — no DOM needed.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
