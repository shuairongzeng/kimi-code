import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'zimi-telemetry',
    include: ['test/**/*.test.ts'],
  },
});
