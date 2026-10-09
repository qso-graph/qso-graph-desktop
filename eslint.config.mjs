// SPDX-License-Identifier: GPL-3.0-only
// QGD-SEC-0013: the ESLint half of the security gates.
//
// The TypeScript source is linted directly, with type information. That became
// possible when TypeScript was pinned to 6.0.3 (QGD-SEC-0019); before it, the
// product was linted after compilation because typescript-eslint would not
// install, which meant findings named a line nobody edits and no type-aware
// rule could run at all.
//
// Type-aware rules are not a tidiness preference here. QGD-SEC-0006 says every
// IPC message, file input and API response is validated and rejected rather
// than coerced, and the rules below are what notice a value crossing a boundary
// as `any` and being used as though it had been checked.
import js from '@eslint/js';
import security from 'eslint-plugin-security';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

// QGD-SEC-0002 to QGD-SEC-0005 and QGD-SEC-0009, as selectors over the syntax
// that carries them. QGD-SEC-0001's string-form timer is left to
// no-implied-eval, which distinguishes setTimeout("code") from setTimeout(5000).
const FORBIDDEN_SYNTAX = [
  {
    selector: "MemberExpression[property.name='exec'][object.name=/^(child_process|childProcess|cp)$/]",
    message: 'QGD-SEC-0002: no child_process.exec. Use spawn or execFile with an argument array.'
  },
  {
    selector: "Property[key.name='shell'][value.value=true]",
    message: 'QGD-SEC-0002: shell: true hands the argument list to a shell. Pass an argument array.'
  },
  {
    selector: "Property[key.value='shell'][value.value=true]",
    message: 'QGD-SEC-0002: shell: true hands the argument list to a shell. Pass an argument array.'
  },
  {
    selector: "ImportExpression[source.type!='Literal']",
    message: 'QGD-SEC-0003: no dynamic import of a path built from input.'
  },
  {
    selector: "CallExpression[callee.object.name='sql'][callee.property.name='raw'][arguments.0.type!='Literal']",
    message: 'QGD-SEC-0005: sql.raw is banned except on a fixed literal.'
  },
  {
    selector: "CallExpression[callee.object.name='shell'][callee.property.name='openExternal'][arguments.0.type!='Identifier']",
    message: 'QGD-SEC-0009: shell.openExternal takes an allowlisted URL, checked before the call.'
  }
];

const SECURITY_AS_ERRORS = Object.fromEntries(
  // The plugin ships its rules as warnings. A warning is not a gate.
  Object.keys(security.configs.recommended.rules).map(rule => [rule, 'error'])
);

const SHARED = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-restricted-syntax': ['error', ...FORBIDDEN_SYNTAX]
};

// What a value crossing a trust boundary must not be allowed to do quietly.
const TYPE_AWARE = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }]
};

export default [
  // storybook-static is the built gallery: vendored code carrying directives
  // for rules this project does not install.
  { ignores: ['node_modules/**', 'dist/**', 'out/**', 'report/**', 'packages/persona-core/target/**', 'storybook-static/**'] },

  // The product, as written.
  ...tseslint.config({
    files: ['packages/**/*.ts', 'packages/**/*.cts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      // Both projects named explicitly: tsconfig.json excludes the renderer,
      // so the service would not find packages/renderer/app.ts on its own.
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.renderer.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: { security },
    rules: { ...SECURITY_AS_ERRORS, ...SHARED, ...TYPE_AWARE, 'security/detect-object-injection': 'off', 'security/detect-non-literal-fs-filename': 'off' }
  }),

  // QGD-SEC-0011, on the source. A compiled component is an innerHTML
  // assignment that cannot be tied back to the tag that produced it.
  ...svelte.configs.recommended.map(config => ({
    ...config,
    files: ['**/*.svelte'],
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...config.languageOptions?.parserOptions,
        // The script blocks are TypeScript, and svelte-eslint-parser hands them
        // to this one. Without it every component was a parse error — which
        // ESLint reports and then has nothing left to review, so the whole
        // family of rules here, no-at-html-tags included, inspected nothing.
        // scripts/lint.mjs asserts a component is actually parsed.
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: { ...config.rules, ...SHARED, 'svelte/no-at-html-tags': 'error' }
  })),

  // The verification scripts. They spawn processes on purpose; what still holds
  // is the ban on evaluating strings and on building a command from input.
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' }
    },
    plugins: { security },
    rules: {
      ...SECURITY_AS_ERRORS,
      ...SHARED,
      // These scripts read and write paths and spawn processes by design, and
      // build patterns over this project's own artifacts. The rules stay on for
      // src/, which is the product; scripts/lint.mjs asserts that directly
      // rather than inferring it from a fixture that lives here.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-child-process': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-unsafe-regex': 'off',
      'security/detect-non-literal-regexp': 'off'
    }
  }
];
