// SPDX-License-Identifier: GPL-3.0-or-later
import type { ExtensionContext } from '../../../packages/extension-api/context.js';
import { isLotwLogResult, isLotwManageReply, isLotwReply, type LotwManageResult, type ExtensionRequest } from '../../../packages/extension-api/api-contract.js';
import { certificatesPage, rootsPage } from './page.js';

// Only outcome words and counts reach the status line. No arbitrary error,
// certificate content or exception is echoed by this extension.
export function outcome(result: LotwManageResult, deleting: boolean): string {
  if (result.status === 'cancelled') return 'Cancelled. No changes were made.';
  if (result.status === 'conflict') return deleting
    ? 'The LoTW store changed since you confirmed. Nothing was deleted. Look at the store again.'
    : 'The LoTW store changed since inspection. Nothing was imported. Look at the store again.';
  const refused = result.certificates.filter(c => c.disposition === 'refused').length;
  const imported = result.certificates.filter(c => c.disposition === 'new').length;
  const present = result.certificates.filter(c => c.disposition === 'present').length;
  return [deleting ? `Deleted ${result.deleted} certificate(s).` : `Imported ${imported} certificate(s).`,
    ...(present ? [`${present} already installed.`] : []),
    ...(refused ? [`${refused} refused; those certificates were unchanged.`] : []),
    ...(result.roots ? [`${result.roots} trusted root(s) added.`] : []),
    ...(result.locations ? [`${result.locations} Location(s) added.`] : []),
    ...(result.skippedLocations.length ? [`${result.skippedLocations.length} Location(s) skipped.`] : [])].join(' ');
}
// The grants are named only when a grant refused the request; any other
// failure would send the operator to Settings for nothing (#200).
export function unreadable(what: string, reply: unknown): string {
  const refused = typeof reply === 'object' && reply !== null && (reply as { ok?: unknown }).ok === false && 'refused' in reply;
  return refused ? `${what} could not be read. Check the LoTW grants in Settings and try again.`
    : `${what} could not be read. Try again; if it keeps happening, check the output.`;
}
export function activate(context: ExtensionContext): void {
  context.subscriptions.push(
    context.pages.register('certificates', async ({ signal }) => {
      const reply = await context.request({ kind: 'lotw.certificates' }, { signal });
      return isLotwReply(reply, 'lotw.certificates') && reply.ok && reply.kind === 'lotw.certificates'
        ? certificatesPage(reply.certificates) : { ok: false, reason: unreadable('LoTW certificates', reply) };
    }),
    context.pages.register('roots', async ({ signal }) => {
      const reply = await context.request({ kind: 'lotw.roots' }, { signal });
      return isLotwReply(reply, 'lotw.roots') && reply.ok && reply.kind === 'lotw.roots'
        ? rootsPage(reply.roots) : { ok: false, reason: unreadable('Trusted roots', reply) };
    }),
    context.pages.onAction('certificates', async event => {
      if ((event.action === 'sign' || event.action === 'upload') && event.row === undefined) {
        const kind = event.action === 'sign' ? 'lotw.sign' : 'lotw.upload';
        const reply = await context.request({ kind });
        if (reply.ok && reply.kind === kind && 'result' in reply && isLotwLogResult(reply.result)) {
          const r = reply.result;
          if (r.status === 'cancelled') return 'Cancelled. Nothing was signed or uploaded.';
          return r.upload ?? `Signed ${r.signed} QSOs; ${r.alreadySigned} already signed and left out; ${r.signAgainCount} signed again; ${r.refused.length} refused; ${r.outsideDates} outside the dates.`;
        }
        return 'The LoTW operation could not finish. Check the output and LoTW before trying again.';
      }
      let request: Extract<ExtensionRequest, { kind: 'lotw.import' | 'lotw.restore' | 'lotw.delete' }>;
      if (event.action === 'load' && event.row === undefined) request = { kind: 'lotw.import' };
      else if (event.action === 'restore' && event.row === undefined) request = { kind: 'lotw.restore' };
      else if (event.action === 'delete' && event.row !== undefined) request = { kind: 'lotw.delete', certificate: event.row };
      else return 'That action is not available.';
      const reply = await context.request(request);
      return isLotwManageReply(reply, request.kind) && reply.ok && 'result' in reply
        ? outcome(reply.result, request.kind === 'lotw.delete')
        : !reply.ok && 'refused' in reply ? 'LoTW refused the operation. Check its grants in Settings and try again.'
          : 'LoTW refused the operation or its outcome is unknown. Refresh and check the store before trying again.';
    })
  );
}
