import { defineConfig } from 'vitest/config';

// Engine tests are pure (node env); UI/Lit component tests will switch to jsdom later.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
