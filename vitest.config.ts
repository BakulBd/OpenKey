import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
    // Hardware-in-the-loop tests only run when explicitly requested.
    exclude: process.env.OPENAK820_HIL === '1' ? [] : ['tests/**/*.hil.test.ts'],
  },
});
