import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'zimi-oauth',
    include: ['test/**/*.test.ts'],
  },
});
