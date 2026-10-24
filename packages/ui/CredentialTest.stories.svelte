<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- QGD-FRM-0010 pattern: credential-test -->
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import CredentialTest from './CredentialTest.svelte';

  const { Story } = defineMeta({
    title: 'patterns/CredentialTest',
    component: CredentialTest,
    args: { outcome: 'untested', onTest: () => {} }
  });
</script>

<!-- Every outcome is reachable, including the one that is neither a pass nor
     a failure: a service we cannot test yet must not look as though it just
     rejected the credential. -->
<Story name="Not tested" />
<Story name="Testing" args={{ outcome: 'testing' }} />
<Story name="Worked" args={{ outcome: 'success' }} />
<Story name="Rejected" args={{ outcome: 'failure' }} />
<Story name="Not supported yet" args={{ outcome: 'unsupported' }} />
<!-- The two states that must never be a dead, silent button. KI7MT found the
     second on Club Log: disabled, unexplained, and drawing a busy cursor. -->
<Story name="Nothing saved to test" args={{ unavailable: 'Save a username and password or API key first, then this can be tested.' }} />
<Story name="Service cannot be tested yet" args={{ unavailable: 'Testing for this service is not implemented yet.' }} />
