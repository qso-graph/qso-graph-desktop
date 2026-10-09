// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0007: every story renders in both themes, so a component is seen in
// each before it is accepted.
//
// The switch sets data-theme on the document element, which is what the shell
// does under QGD-FRM-0001 and QGD-FRM-0002 — the gallery shows a component the
// way the application will, not an approximation of it.
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import '../packages/renderer/style.css';

export const decorators = [
  withThemeByDataAttribute({
    themes: { light: 'light', dark: 'dark' },
    defaultTheme: 'light',
    attributeName: 'data-theme'
  })
];

export const parameters = {
  controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } }
};
