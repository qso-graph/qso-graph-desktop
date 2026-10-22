<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The top of Home: ours, as the top of a GitHub profile is its owner's
  (KI7MT, 2026-10-22). It says what QSO Graph Desktop is, and every part of
  it does something: each point opens the place it speaks of, the release
  line opens what is new, and a new install gets three steps that disappear
  once done. Static words and what the window already knows; nothing is
  fetched, and nothing here repeats the status bar.
-->
<script lang="ts">
  import { ICONS } from '../../ui/icons.js';
  import { HIGHLIGHT } from '../../ui/release.js';
  import { forStore } from '../../callsigns/credential-store.js';
  import type { WelcomeStep } from '../welcome.js';

  interface Props {
    platform: string;
    // Undefined until known; empty once every step is done.
    steps: readonly WelcomeStep[] | undefined;
    onGo: (place: 'callsigns' | 'stations' | 'settings') => void;
    onCustomize: () => void;
    onWhatsNew: () => void;
    // Where to get it for another computer, in the browser.
    onDownloads: () => void;
    // How to write an extension, in the browser.
    onContributing: () => void;
    // A program's or standard's own home page, in the browser.
    onSite: (name: 'adif' | 'pota' | 'sota' | 'iota') => void;
  }
  const { platform, steps, onGo, onCustomize, onWhatsNew, onDownloads, onContributing, onSite }: Props = $props();

  const POINTS = $derived([
    // Each icon in its place's hue; the pill stays plain (Watson, 2026-10-22).
    { id: 'welcome-logins', icon: 'callsigns', hue: 'callsigns', text: forStore('Logins in your Keychain', platform), go: () => onGo('callsigns') },
    { id: 'welcome-locations', icon: 'stations', hue: 'locations', text: 'Locations ready for LoTW, POTA and SOTA', go: () => onGo('stations') },
    { id: 'welcome-pins', icon: 'extension', hue: 'general', text: 'Pin what you use', go: onCustomize }
  ]);
  const STEP_PLACE = { callsign: 'callsigns', location: 'stations', adif: 'settings', parks: 'settings', summits: 'settings' } as const;
</script>

<section class="home-welcome" id="home-welcome" aria-labelledby="welcome-headline">
  <h2 id="welcome-headline">QSO Graph Desktop</h2>
  <p class="welcome-tagline">
    Free, open-source ham radio software. Your callsigns, your locations and the tools you pick,
    on your own computer, with no account and nothing sent anywhere you didn't ask.
  </p>
  <ul class="welcome-points">
    {#each POINTS as point (point.id)}
      <li>
        <button type="button" class="welcome-point" id={point.id} data-hue={point.hue} onclick={point.go}>
          <svg viewBox={ICONS[point.icon]?.viewBox} aria-hidden="true" fill="currentColor"><path d={ICONS[point.icon]?.path} /></svg>
          {point.text}
        </button>
      </li>
    {/each}
  </ul>
  <!-- The selling points (KI7MT, 2026-10-22), each a heading and then its
       message, and each with a link that does something. Said as it is:
       IOTA is next, other authors' extensions arrive with their sandbox, and
       a login's secret, not its username, is what never touches a file. -->
  <div class="welcome-features">
    <section class="welcome-feature" id="welcome-speaks" aria-labelledby="welcome-speaks-title">
      <h3 id="welcome-speaks-title">Speaks the Language Hams Use</h3>
      <p>
        <button type="button" class="link-button" onclick={() => onSite('adif')}>ADIF</button> definitions straight
        from the ADIF Development Group, every location checked against them;
        <button type="button" class="link-button" onclick={() => onSite('pota')}>POTA</button> parks and
        <button type="button" class="link-button" onclick={() => onSite('sota')}>SOTA</button> summits, a location
        made from either in a click; and <button type="button" class="link-button" onclick={() => onSite('iota')}>IOTA</button> islands next.
      </p>
    </section>
    <section class="welcome-feature" id="welcome-runs" aria-labelledby="welcome-runs-title">
      <h3 id="welcome-runs-title">Runs Where You Run</h3>
      <p>
        Windows, Linux (down to a Raspberry Pi 5) and macOS. On Linux it's a single AppImage: no installer,
        no root, nothing to set up. Download it and run it, at home or off a USB stick in the field. Rather
        install it? There's a .deb and an .rpm too.
        <button type="button" class="link-button" id="welcome-downloads" onclick={onDownloads}>Get it for another computer</button>
      </p>
    </section>
    <section class="welcome-feature" id="welcome-extensions" aria-labelledby="welcome-extensions-title">
      <h3 id="welcome-extensions-title">No Vendor or Developer Lock-In</h3>
      <p>
        Everything past the core, Conditions included, is an extension, built on the same extension API
        other hams will build on, and you choose which ones run. Extensions by other authors arrive once
        the sandbox they run in is finished.
        <button type="button" class="link-button" id="welcome-contributing" onclick={onContributing}>Write one</button>
      </p>
    </section>
    <section class="welcome-feature" id="welcome-services" aria-labelledby="welcome-services-title">
      <h3 id="welcome-services-title">Major Online Log Integration</h3>
      <p>
        {forStore('LoTW, QRZ (lookups and the logbook), eQSL, HamQTH and Club Log, set up once for each callsign, with every password and API key kept secure in your Keychain and never in a file.', platform)}
        <button type="button" class="link-button" id="welcome-services-link" onclick={() => onGo('callsigns')}>Set them up</button>
      </p>
    </section>
  </div>
  {#if steps && steps.length > 0}
    <div class="welcome-steps" id="welcome-steps">
      <h3>Get started</h3>
      <ul>
        {#each steps as step (step.id)}
          <li class:done={step.done}>
            <button type="button" class="link-button" id="welcome-step-{step.id}" onclick={() => onGo(STEP_PLACE[step.id])}
              aria-label={step.done ? `${step.label}: done` : step.label}>
              <span class="welcome-box" aria-hidden="true">{step.done ? '✓' : ''}</span>{step.label}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  <p class="welcome-new" id="welcome-new-line">
    <strong>New in this release:</strong> {HIGHLIGHT}
    <button type="button" class="link-button" id="welcome-whats-new" onclick={onWhatsNew}>What's new</button>
  </p>
</section>
