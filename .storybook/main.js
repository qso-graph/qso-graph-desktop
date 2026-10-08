// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0006 to QGD-FRM-0009: the component gallery.
//
// Development-only. electron-builder packages dist/, package.json and LICENSE
// and nothing else, so neither this nor storybook-static reaches the shipped
// application — that is structural rather than a promise, and a test asserts it.
//
// At QGD-PRT-0107 this moves to storybook/ at the repository root, with the
// rest of the layout in QGD-REP-0001.
export default {
  framework: { name: '@storybook/svelte-vite', options: {} },
  stories: ['../src/**/*.stories.@(js|ts|svelte)'],
  addons: ['@storybook/addon-themes'],
  core: {
    // Nothing is reported anywhere. QGD-LOG-0002's no-telemetry rule is about
    // the product; the same answer applies to the tools around it.
    disableTelemetry: true,
    disableWhatsNewNotifications: true
  },
  viteFinal: config => ({ ...config, base: './' })
};
