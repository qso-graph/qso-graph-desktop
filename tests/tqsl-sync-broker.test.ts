// SPDX-License-Identifier: GPL-3.0-or-later
import { EventEmitter } from 'node:events';
import { beforeEach, it, expect, vi } from 'vitest';
const electron = vi.hoisted(() => ({ handler: undefined as any, remove:vi.fn(), app:undefined as any }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events'); electron.app = new EventEmitter();
  return { app:electron.app, ipcMain:{handle:(_channel:string,handler:unknown)=>{electron.handler=handler;},removeHandler:electron.remove} };
});
import { startTqslSyncBroker } from '../packages/main/tqsl-sync-broker.js';
beforeEach(()=>{electron.app.removeAllListeners();vi.clearAllMocks();});
const event = () => { const mainFrame={url:'qg://desktop/index.html'}; return {sender:Object.assign(new EventEmitter(),{mainFrame}),senderFrame:mainFrame}; };
it('only the shell main frame can request Sync, with no path or other arguments', async () => {
  const run = vi.fn(async () => ({status:'cancelled' as const,folder:'',locations:[],added:0})); const stop=startTqslSyncBroker(run);
  const e=event();
  for (const [frame,args] of [[{},[]],[{url:'https://example.test'},[]],[e.senderFrame,[{path:'/test-only'}]]] as const) {
    expect((await electron.handler({...e,senderFrame:frame},...args)).ok).toBe(false);
  }
  expect(run).not.toHaveBeenCalled(); expect((await electron.handler(e)).ok).toBe(true); expect(run).toHaveBeenCalledOnce(); stop();
});
it.each(['destroyed','did-start-navigation','confirmed-quit'])('requester %s aborts pending work and releases listeners', async how => {
  let signal:AbortSignal|undefined;
  const run=vi.fn((s:AbortSignal)=>{signal=s;return new Promise<any>(resolve=>s.addEventListener('abort',()=>resolve({status:'cancelled',folder:'',locations:[],added:0}),{once:true}));});
  const stop=startTqslSyncBroker(run); const e=event(); const pending=electron.handler(e);
  if(how==='confirmed-quit') stop(); else e.sender.emit(how);
  expect(signal?.aborted).toBe(true); expect((await pending).result.status).toBe('cancelled');
  expect(e.sender.listenerCount('destroyed')).toBe(0); expect(e.sender.listenerCount('did-start-navigation')).toBe(0); stop();
});
it('errors return fixed guidance without source paths or file contents', async () => {
  const stop=startTqslSyncBroker(async()=>{throw new Error('/test-only/private/source-content');});
  const reply=await electron.handler(event());expect(reply.ok).toBe(false);expect(JSON.stringify(reply)).not.toContain('/test-only');stop();
});

it('passes the flow\'s fixed guidance through, and replaces anything else', async () => {
  const { TQSL_SYNC_MESSAGES } = await import('../packages/main/tqsl-sync.js');
  for (const message of TQSL_SYNC_MESSAGES) {
    const stop = startTqslSyncBroker(async () => { throw new Error(message); });
    expect(await electron.handler(event())).toEqual({ ok: false, error: message });
    stop();
  }
  const stop = startTqslSyncBroker(async () => { throw new Error(`${TQSL_SYNC_MESSAGES[0]} /test-only`); });
  expect((await electron.handler(event())).error).not.toContain('/test-only');
  stop();
});
it('the read refusal matches the credential core\'s own words', async () => {
  const { readFileSync } = await import('node:fs');
  const { TQSL_READ_REFUSED } = await import('../packages/callsigns/lotw-contract.js');
  const rust = readFileSync('packages/callsign-core/src/tqsl_sync.rs', 'utf8');
  expect(rust).toContain(`const REFUSED: &str = ${JSON.stringify(TQSL_READ_REFUSED)};`);
});
