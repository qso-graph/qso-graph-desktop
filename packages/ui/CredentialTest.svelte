<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!--
  The credential test and what it reports back.

  The pattern is that the result is a state with a name, not a coloured string:
  untested, testing, success, failure and unsupported each read differently and
  each is reachable, so a later service that cannot be tested yet says so
  rather than appearing to have failed.

  QGD-CRD-0006: nothing here displays a secret. It reports whether a stored
  credential worked, which is all the renderer is ever told.
-->
<script lang="ts">
  export type TestOutcome = 'untested' | 'testing' | 'success' | 'failure' | 'unsupported';

  interface Props {
    outcome: TestOutcome;
    message?: string;
    // Why it cannot be pressed. A disabled control that gives no reason is the
    // defect this pattern exists to stop being written again: on Club Log the
    // Test button was dead, silent, and drawn with a busy cursor.
    unavailable?: string;
    onTest: () => void;
  }
  const { outcome, message, unavailable, onTest }: Props = $props();
  const disabled = $derived(Boolean(unavailable) || outcome === 'testing');

  const DEFAULTS: Record<TestOutcome, string> = {
    untested: 'Not tested yet.',
    testing: 'Testing…',
    success: 'The saved credential worked.',
    failure: 'The service rejected the saved credential.',
    unsupported: 'Testing for this service is not implemented yet.'
  };
</script>

<div class="credential-test">
  <button
    type="button"
    class="secondary"
    class:working={outcome === 'testing'}
    {disabled}
    aria-describedby="credential-test-reason"
    aria-busy={outcome === 'testing' ? 'true' : undefined}
    onclick={onTest}
  >Test credential</button>
  <p
    id="credential-test-reason"
    class="credential-test-result"
    class:success={outcome === 'success'}
    class:error={outcome === 'failure'}
    role="status"
    aria-busy={outcome === 'testing' ? 'true' : undefined}
  >{unavailable ?? message ?? DEFAULTS[outcome]}</p>
</div>
