<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  QGD-FRM-0002: System, Light and Dark, with System the default. The control
  reports a choice and holds no state of its own — what is selected is whatever
  was last stored, so a write that fails leaves the control showing the truth
  rather than the attempt.
-->
<script lang="ts">
  import { THEME_CHOICES, isThemeChoice, type ThemeChoice } from '../../settings-contract.js';

  interface Props {
    choice: ThemeChoice;
    onChoose: (choice: ThemeChoice) => void;
  }
  const { choice, onChoose }: Props = $props();

  const LABELS: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

  function changed(event: Event & { currentTarget: HTMLSelectElement }): void {
    const value = event.currentTarget.value;
    // Validated rather than trusted, like every other value crossing into the
    // application (QGD-SEC-0006) — even one this component wrote itself.
    if (isThemeChoice(value)) onChoose(value);
  }
</script>

<label for="theme-choice">Theme</label>
<select id="theme-choice" value={choice} onchange={changed}>
  {#each THEME_CHOICES as option (option)}
    <option value={option}>{LABELS[option]}</option>
  {/each}
</select>
