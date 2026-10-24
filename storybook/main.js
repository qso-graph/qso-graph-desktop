// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0006 to QGD-FRM-0009: the component gallery.
//
// Development-only. electron-builder packages dist/, package.json and LICENSE
// and nothing else, so neither this nor storybook-static reaches the shipped
// application — that is structural rather than a promise, and a test asserts it.
//
// Moved here from .storybook at QGD-PRT-0107, with the rest of the layout in
// QGD-REP-0001. Storybook is pointed at it by `-c storybook`, since its own
// default is the dot-directory.
export default {
  framework: { name: '@storybook/svelte-vite', options: {} },
  stories: ['../packages/**/*.stories.@(js|ts|svelte)'],
  // addon-svelte-csf provides the indexer for .stories.svelte. Without it that
  // format is accepted by the glob and then fails indexing with "No matching
  // indexer found" — an advertised format that breaks the build.
  addons: ['@storybook/addon-themes', '@storybook/addon-svelte-csf'],
  core: {
    // Nothing is reported anywhere. QGD-LOG-0002's no-telemetry rule is about
    // the product; the same answer applies to the tools around it.
    disableTelemetry: true,
    disableWhatsNewNotifications: true
  },
  // The gallery is never a proofs build: the constant has to exist or
  // shell-store throws when Rail's story imports PAGES.
  viteFinal: config => ({
    ...config,
    base: './',
    define: { ...config.define, __QG_PROOFS__: 'false' }
  })
};
