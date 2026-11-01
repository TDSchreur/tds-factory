import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['vendor/**', 'dashboard/vendor/**', '.factory/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-shadow': 'error',
      // Existing code intentionally matches control characters and ignores some caught errors.
      'no-control-regex': 'off',
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-useless-escape': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['dashboard/*.js'],
    languageOptions: { globals: globals.browser },
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  // Cleanup failure is deliberately reported from finally in this lock helper.
  { files: ['src/run-folder.js'], rules: { 'no-unsafe-finally': 'off' } },
];
