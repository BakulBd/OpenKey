import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 're/**', 'fixtures/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
  {
    // Protocol code must never touch platform HID APIs directly; those belong to transports.
    files: [
      'packages/protocols/src/**/*.ts',
      'packages/core/src/**/*.ts',
      'packages/tft/src/**/*.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'navigator', message: 'Use an HidTransport instead.' },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', 'fs', 'node-hid', '@openkey/hid-node'] },
      ],
    },
  },
);
