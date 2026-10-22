<!-- SPDX-License-Identifier: GPL-3.0-only -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SetupPage from './SetupPage.svelte';
  import type { ServiceSummary } from '../../personas/persona-contract.js';

  // Two services, drawn the way the register describes them: one with a
  // username and a password and a test, one with a key and no test. The
  // screen knows nothing about either (QGD-PSN-0002).
  const services: ServiceSummary[] = [
    {
      id: 'qrz', name: 'QRZ.com', what: 'Callsign lookup — who a callsign belongs to, and where',
      site: 'https://www.qrz.com/',
      howToGet: 'A QRZ account. Lookup by callsign needs an XML subscription; the account alone will be refused.',
      fields: [
        { name: 'username', label: 'QRZ username', secret: false, required: true },
        { name: 'password', label: 'QRZ password', secret: true, required: true }
      ],
      expiry: { known: false, why: 'A QRZ password does not expire on a date.' },
      test: { what: 'Asks QRZ for a session with the username and password, and nothing else' }
    },
    {
      id: 'clublog', name: 'Club Log', what: 'DXCC analysis and log upload',
      site: 'https://clublog.org/',
      howToGet: 'A Club Log account, and an API key the operator asks Club Log for.',
      fields: [
        { name: 'username', label: 'Club Log email', secret: false, required: true },
        { name: 'password', label: 'Club Log password', secret: true, required: true },
        { name: 'api_key', label: 'Club Log API key', secret: true, required: false }
      ],
      expiry: { known: false, why: 'Neither the password nor the key carries an expiry date.' },
      test: { none: 'This product has no test for Club Log yet. The credential is saved and used.' }
    }
  ];

  const { Story } = defineMeta({
    title: 'pages/SetupPage',
    component: SetupPage,
    args: {
      services,
      onCreateCallsign: () => Promise.resolve(undefined),
      onSaveCredential: () => Promise.resolve(undefined),
      onDone: () => {}
    }
  });
</script>

<!-- The first thing a new operator sees: one field, and everything else can
     wait (QGD-PSN-0004). -->
<Story name="Asking for a callsign" />

<!-- Returning to a setup whose persona already exists starts at the first
     service rather than asking for the callsign again. -->
<Story name="At the first service" args={{ persona: 'home' }} />

<!-- A persona that cannot be created says why, and stays where it is. -->
<Story name="The callsign was refused" args={{
  onCreateCallsign: () => Promise.resolve('Enter a callsign.')
}} />

<!-- A credential the Keychain refused. The step does not advance, so nothing
     is skipped by accident. -->
<Story name="A credential could not be saved" args={{
  persona: 'home',
  onSaveCredential: () => Promise.resolve('Keychain could not save this credential.')
}} />
