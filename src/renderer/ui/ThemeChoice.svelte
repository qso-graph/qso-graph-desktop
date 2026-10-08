<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  QGD-FRM-0002: System, Light and Dark, with System the default. What is
  selected is whatever was last stored, never the attempt — so a save that
  fails leaves the control showing the theme the application is actually using.
-->
<script lang="ts">
  import { THEME_CHOICES, isThemeChoice, type ThemeChoice } from '../../settings-contract.js';

  interface Props {
    choice: ThemeChoice;
    // Answers whether the choice was stored. The control shows the stored
    // theme, so it has to be told.
    onChoose: (choice: ThemeChoice) => Promise<boolean>;
  }
  const { choice, onChoose }: Props = $props();

  const LABELS: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

  let failed = $state(false);

  async function changed(event: Event & { currentTarget: HTMLSelectElement }): Promise<void> {
    const select = event.currentTarget;
    const value = select.value;
    // Validated rather than trusted, like every other value crossing into the
    // application (QGD-SEC-0006) — even one this component wrote itself.
    if (!isThemeChoice(value)) {
      select.value = choice;
      return;
    }
    const stored = await onChoose(value);
    failed = !stored;
    // The browser has already moved the selection, and `value={choice}` does
    // not rewrite the DOM when the prop has not changed — so without this a
    // refused save left Settings showing a theme nothing was using.
    if (!stored) select.value = choice;
  }
</script>

<label for="theme-choice">Theme</label>
<select id="theme-choice" value={choice} onchange={changed} aria-describedby="theme-status">
  {#each THEME_CHOICES as option (option)}
    <option value={option}>{LABELS[option]}</option>
  {/each}
</select>
<p id="theme-status" class="field-error" role="status" hidden={!failed}>
  The theme could not be saved. It is unchanged.
</p>
