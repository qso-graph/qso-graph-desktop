// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLotwLog, createLotwDialogGate, type LotwLogPorts } from '../packages/main/lotw-log.js';
import { isLotwCommand, isLotwLogPreview, isLotwLogOutcome, isLotwLocationMessage } from '../packages/callsigns/lotw-contract.js';
import { validateRequest, requiredGrant, isLotwLogResult } from '../packages/extension-api/api-contract.js';
import { plainRequest } from '../packages/extension-api/plain.js';
import type { NativeLotwLogPreview } from '../packages/callsign-core/native.js';
const token='3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const cert={id:'cert:'+token,call:'QG0TEST',serial:'AB12',qsoFirst:'2020-01-01',qsoLast:'2099-12-31'};
const preview=(): NativeLotwLogPreview=>({token,qsos:4,first:'2026-01-01',last:'2026-11-01',calls:['QG0TEST'],refused:[{record:3,line:12,field:'MY_STATE',reason:'Disagrees with the selected Location or callsign.'}],outsideDates:0,alreadySigned:1,toSign:2,signAgainCount:0,fields:{CALL:'QG0TEST',DXCC:'291',US_STATE:'ID'},certificates:[cert],certificate:cert});
function harness(){
 const commands: string[]=[];
 const ports: LotwLogPorts={
  core:vi.fn(async c=>{commands.push(c.op);if(c.op==='logSign')return {signed:2,outsideDates:0,alreadySigned:1,signAgainCount:0,refused:preview().refused};if(c.op==='uploadSend')return 'LoTW accepted the signed log for processing.';if(c.op==='logCancel'||c.op==='logDiscard')return null;return preview();}),
  context:async()=>({calls:[{call:'QG0TEST'}],activeCall:'QG0TEST',activeLocation:token,locations:[{id:token,name:'Test Location',place:{MY_DXCC:'291',MY_STATE:'ID'}}]}),
  choose:vi.fn(async upload=>upload?'/test-only/log.tq8':'/test-only/log.adi'), save:vi.fn(async()=>'/test-only/log.tq8'),
  confirmSign:vi.fn(async()=>true),confirmUpload:vi.fn(async()=>true),result:vi.fn(async()=>false)
 };return {ports,commands,run:createLotwLog(ports)};
}
describe('LoTW sign and separately confirmed upload',()=>{
 it('prepares, confirms, chooses output, signs, and never uploads automatically',async()=>{
  const h=harness();const r=await h.run('lotw.sign',()=>true);
  expect(r.signed).toBe(2);expect(h.commands).toEqual(['logPrepare','logPreview','logSign']);expect(h.ports.confirmSign).toHaveBeenCalledOnce();expect(h.ports.save).toHaveBeenCalledOnce();expect(h.ports.confirmUpload).not.toHaveBeenCalled();
  expect(vi.mocked(h.ports.confirmSign).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(h.ports.save).mock.invocationCallOrder[0]);
 });
 it.each(['open','confirm','save'] as const)('Cancel at %s signs and writes nothing',async step=>{
  const h=harness();if(step==='open')vi.mocked(h.ports.choose).mockResolvedValue(undefined);if(step==='confirm')vi.mocked(h.ports.confirmSign).mockResolvedValue(false);if(step==='save')vi.mocked(h.ports.save).mockResolvedValue(undefined);
  expect((await h.run('lotw.sign',()=>true)).status).toBe('cancelled');expect(h.commands).not.toContain('logSign');expect(h.commands).not.toContain('uploadSend');if(step!=='open')expect(h.commands.at(-1)).toBe('logCancel');
 });
 it('result upload skips Open and requires a new inspection and confirmation',async()=>{
  const h=harness();vi.mocked(h.ports.result).mockResolvedValue(true);await h.run('lotw.sign',()=>true);
  expect(h.ports.choose).toHaveBeenCalledTimes(1);expect(h.ports.confirmUpload).toHaveBeenCalledOnce();expect(h.commands).toEqual(['logPrepare','logPreview','logSign','uploadInspect','uploadSend']);
 });
 it('upload confirmation Cancel sends nothing and consumes inspection',async()=>{const h=harness();vi.mocked(h.ports.confirmUpload).mockResolvedValue(false);await h.run('lotw.upload',()=>true);expect(h.commands).toEqual(['uploadInspect','logCancel']);});
 it('aborts an outstanding dialog, cleans the token, and ignores its late answer',async()=>{
  const h=harness();let answer!:(v:boolean)=>void;const opened=Promise.withResolvers<void>();vi.mocked(h.ports.confirmSign).mockImplementation(()=>{opened.resolve();return new Promise(resolve=>{answer=resolve;});});const abort=new AbortController();const running=h.run('lotw.sign',()=>true,abort.signal);await opened.promise;abort.abort();expect((await running).status).toBe('cancelled');answer(true);await Promise.resolve();expect(h.commands).toEqual(['logPrepare','logPreview','logCancel']);
 });
 it('aborts during core preparation and cancels the returned token before releasing',async()=>{
  const h=harness();const prepared=Promise.withResolvers<unknown>();vi.mocked(h.ports.core).mockImplementationOnce(()=>prepared.promise);const abort=new AbortController();const running=h.run('lotw.sign',()=>true,abort.signal);await vi.waitFor(()=>expect(h.ports.core).toHaveBeenCalled());abort.abort();prepared.resolve(preview());expect((await running).status).toBe('cancelled');expect(h.ports.core).toHaveBeenLastCalledWith({op:'logCancel',token});
 });
 it('holds one slot across management, signing and upload dialogs',async()=>{const gate=createLotwDialogGate();const done=Promise.withResolvers<void>();const first=gate(()=>done.promise);await expect(gate(async()=>{})).rejects.toThrow('Finish');done.resolve();await first;await expect(gate(async()=>true)).resolves.toBe(true);});
 it('rechecks upload permission after confirmation',async()=>{const h=harness();let allowed=true;vi.mocked(h.ports.confirmUpload).mockImplementation(async()=>{allowed=false;return true;});await expect(h.run('lotw.upload',()=>allowed)).rejects.toThrow('no longer permitted');expect(h.commands).toEqual(['uploadInspect','logCancel']);});
 it('refuses paths, contents and confirmation answers at both extension boundaries',()=>{
  for(const kind of ['lotw.sign','lotw.upload'] as const){expect(requiredGrant({kind})).toBe(kind.replace('.',':'));expect(validateRequest({kind})).toEqual({kind});for(const field of ['path','contents','confirmed','token','selection']){const injected={kind,[field]:'/test-only'};expect(()=>validateRequest(injected)).toThrow();expect(()=>plainRequest(injected)).toThrow();}}
 });
 it('validates native requests and replies exactly',()=>{
  expect(isLotwLogPreview(preview())).toBe(true);expect(isLotwLogPreview({...preview(),key:'forbidden'})).toBe(false);
  expect(isLotwCommand({op:'logPrepare',path:'/test-only/log.adi'})).toBe(true);
  expect(isLotwCommand({op:'logSign',token,path:'/test-only/log.tq8',confirmed:true})).toBe(false);
  expect(isLotwCommand({op:'logPreview',token,selection:{call:'QG0TEST',place:{MY_DXCC:'291'},park:'',certificate:'',from:'',to:'',signAgain:false,qth:'Ignore'}})).toBe(false);
 });
 it('has no production transport reachable in a Rust test and fixes the endpoint in the library',()=>{
  const source=readFileSync('packages/callsign-core/src/lotw_log.rs','utf8');const tls=readFileSync('packages/callsign-core/src/validation.rs','utf8');
  expect(source).toMatch(/if cfg!\(test\) \|\| test\s*\{\s*return Err\(\(\)\);\s*\}/);expect(tls).toContain('if cfg!(test) || std::env::var_os("QG_DESKTOP_TEST_KEYCHAIN").is_some()');expect(tls).toContain('client.post(request.url())');expect(source).toMatch(/assert_eq!\(request.url\(\),\s*upload::UPLOAD_URL\)/);expect(source).not.toMatch(/https?:\/\//);
 });
});
it('holds the shared gate until an unabortable native chooser closes', async () => {
 const gate=createLotwDialogGate();const native=Promise.withResolvers<void>();const open=gate.track(()=>native.promise);
 await expect(gate(async()=>true)).rejects.toThrow('Finish');native.resolve();await open;await expect(gate(async()=>true)).resolves.toBe(true);
});
it('opens the chooser when the initial Location cannot sign, allowing a correction', async () => {
 const h=harness();const core=h.ports.core;vi.mocked(h.ports.core).mockImplementationOnce(async()=>preview()).mockImplementationOnce(async()=>{throw new Error('Location needs DXCC');});
 const noCertificate={...preview(),certificate:null};
 vi.mocked(h.ports.core).mockImplementation(async c=>c.op==='logPreview'?preview():c.op==='logSign'?{signed:2,outsideDates:0,alreadySigned:1,signAgainCount:0,refused:[]}:noCertificate);
 vi.mocked(h.ports.confirmSign).mockImplementation(async (_file,_preview,_context,update)=>{await update({call:'QG0TEST',place:{MY_DXCC:'291',MY_STATE:'ID'},park:'',certificate:'',from:'',to:'',signAgain:false});return true;});
 expect((await h.run('lotw.sign',()=>true)).signed).toBe(2);expect(h.ports.confirmSign).toHaveBeenCalledOnce();expect(core).toHaveBeenCalled();
});

it('checks date-exclusion counts at the native and extension boundaries',()=>{
 const p={...preview(),outsideDates:2};
 const outcome={signed:2,alreadySigned:1,signAgainCount:0,outsideDates:2,refused:p.refused};
 const result={...outcome,status:'completed',upload:null};
 expect(isLotwLogPreview(p)).toBe(true);expect(isLotwLogOutcome(outcome)).toBe(true);expect(isLotwLogResult(result)).toBe(true);
 for(const outsideDates of [undefined,-1,1.5,'2']) {
  expect(isLotwLogPreview({...p,outsideDates})).toBe(false);
  expect(isLotwLogOutcome({...outcome,outsideDates})).toBe(false);
  expect(isLotwLogResult({...result,outsideDates})).toBe(false);
 }
});

it('keeps fixed Location guidance through the initial preview failure',async()=>{
 const h=harness();const message="Check the Location's grid squares before signing.";
 vi.mocked(h.ports.core).mockImplementation(async c=>{if(c.op==='logPreview')throw new Error(message);return c.op==='logCancel'?null:preview();});
 vi.mocked(h.ports.confirmSign).mockImplementation(async (_file,_preview,context)=>{expect(context.previewProblem).toBe(message);return false;});
 expect((await h.run('lotw.sign',()=>false)).status).toBe('cancelled');
});
it('allows only fixed Location guidance across error boundaries',()=>{
 const source=readFileSync('packages/callsign-core/src/lotw_log.rs','utf8');
 const guidance=source.slice(source.indexOf('fn location_error('),source.indexOf('fn public_cert('));
 const messages=[...guidance.matchAll(/"((?:Check |The Location)[^"]+)"/g)].map(m=>m[1]);
 expect(messages.length).toBeGreaterThan(0);
 for(const message of messages) {expect(isLotwLocationMessage(message)).toBe(true);expect(isLotwLocationMessage(message+' qg-test-input')).toBe(false);}
 for(const text of ['/qg-test/private-path','qg-test-input','Check the Location: qg-test-input'])expect(isLotwLocationMessage(text)).toBe(false);
});
