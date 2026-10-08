// SPDX-License-Identifier: GPL-3.0-only
// QGD-SEC-0013: the ESLint half of the security gates.
//
// The product is TypeScript, and typescript-eslint peers on TypeScript below
// 6.1 while this project is on 7.0.2 — so the TypeScript is linted after
// compilation, as dist/. That is not a compromise for these particular rules:
// eval, a shell spawn, a dynamic require, a raw SQL call and an unsafe timer
// all survive compilation unchanged, and dist/ is what actually ships.
//
// Product code is held to the full set. The verification scripts are held to
// less, because spawning a child process is what several of them exist to do.
import js from '@eslint/js';
import security from 'eslint-plugin-security';
import svelte from 'eslint-plugin-svelte';

// QGD-SEC-0002 to QGD-SEC-0005 and QGD-SEC-0009, as selectors over the syntax
// that carries them. QGD-SEC-0001's string-form timer is left to no-implied-eval,
// which distinguishes setTimeout("code") from setTimeout(5000); a selector on the
// argument's type cannot.
const FORBIDDEN_SYNTAX = [
  {
    selector: "MemberExpression[property.name='exec'][object.name=/^(child_process|childProcess|cp)$/]",
    message: 'QGD-SEC-0002: no child_process.exec. Use spawn or execFile with an argument array.'
  },
  {
    selector: "CallExpression[callee.name=/^exec$/][arguments.0.type!='ArrayExpression']",
    message: 'QGD-SEC-0002: no exec. Use spawn or execFile with an argument array.'
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

export default [
  { ignores: ['node_modules/**', 'out/**', 'report/**', 'native/**/target/**', 'dist/native/**'] },

  // The product, after compilation.
  {
    files: ['dist/**/*.js', 'dist/**/*.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    plugins: { security },
    rules: {
      ...js.configs.recommended.rules,
      // The plugin ships its rules as warnings. A warning is not a gate: these
      // are the dynamic-require and unsafe-regex bans QGD-SEC-0003 relies on,
      // so they are errors here.
      ...Object.fromEntries(Object.keys(security.configs.recommended.rules).map(rule => [rule, 'error'])),
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': ['error', ...FORBIDDEN_SYNTAX],
      // Compiled output legitimately carries shapes a source linter would question.
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-undef': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      // Compiler output, not written by hand: these are style, not security.
      'no-useless-assignment': 'off',
      // src/persona-contract.ts rejects control characters on purpose, and the
      // only way to name them is a control-character class.
      'no-control-regex': 'off'
    }
  },

  // QGD-SEC-0011, for when P3 brings the screens.
  ...svelte.configs.recommended.map(config => ({
    ...config,
    files: ['**/*.svelte'],
    rules: { ...config.rules, 'svelte/no-at-html-tags': 'error' }
  })),

  // The verification scripts. They spawn processes on purpose; what still holds
  // is the ban on evaluating strings and on building a command from input.
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' } },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': ['error',
        ...FORBIDDEN_SYNTAX.filter(rule => !rule.selector.startsWith('CallExpression[callee.name=/^exec$/]'))
      ]
    }
  }
];
