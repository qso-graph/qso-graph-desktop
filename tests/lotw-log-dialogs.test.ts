// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import type { NativeLotwLogPreview } from '../packages/callsign-core/native.js';
const electron=vi.hoisted(()=>({windows:[] as any[],options:[] as any[],choose:vi.fn(),save:vi.fn(),confirm:vi.fn(),ipc:undefined as any,handlers:new Map<string,Function>()}));
vi.mock('electron',async()=>{
 const {EventEmitter}=await import('node:events');
 class Window extends EventEmitter {static getFocusedWindow(){return undefined;}webContents=Object.assign(new EventEmitter(),{mainFrame:{},setWindowOpenHandler:vi.fn()});destroyed=false;constructor(options:unknown){super();electron.windows.push(this);electron.options.push(options);}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}show=vi.fn();loadURL=vi.fn(async()=>{this.emit('ready-to-show');});}
 electron.ipc=Object.assign(new EventEmitter(),{handle:(name:string,fn:Function)=>electron.handlers.set(name,fn),removeHandler:(name:string)=>electron.handlers.delete(name)});
 return {BrowserWindow:Window,dialog:{showOpenDialog:electron.choose,showSaveDialog:electron.save,showMessageBox:electron.confirm},ipcMain:electron.ipc,session:{fromPartition:()=>({setPermissionRequestHandler:vi.fn(),webRequest:{onBeforeRequest:vi.fn()}})}};
});
import { lotwLogDialogs, logPreviewText, uploadConfirmation } from '../packages/main/lotw-log-dialogs.js';
const cert={id:'cert:test',call:'QG0TEST',serial:'AB12',qsoFirst:'2020-01-01',qsoLast:'2099-12-31'};
const p=():NativeLotwLogPreview=>({token:'test',qsos:3,first:'2026-01-01',last:'2026-11-01',calls:['QG0TEST'],refused:[{record:2,line:8,field:'MY_STATE',reason:'Disagrees with Location.'}],outsideDates:0,alreadySigned:1,toSign:1,signAgainCount:0,fields:{CALL:'QG0TEST',DXCC:'291',US_STATE:'ID'},certificates:[cert],certificate:cert});
const context={calls:[{call:'QG0TEST'},{call:'QG1TEST'}],activeCall:'QG0TEST',locations:[{id:'test-location',name:'Test Location',place:{MY_DXCC:'291'}}],activeLocation:'test-location'};
beforeEach(()=>{electron.windows.length=0;electron.options.length=0;electron.handlers.clear();electron.ipc.removeAllListeners();vi.clearAllMocks();});
it('shows every required signing choice and preview field in the main-owned confirmation',async()=>{
 const result=lotwLogDialogs('/dist').confirmSign('qg-test.adi',p(),context,vi.fn());const window=electron.windows[0];const html=decodeURIComponent(window.loadURL.mock.calls[0][0].slice('data:text/html,'.length));
 for(const text of ['qg-test.adi','Callsign:','QG0TEST','QG1TEST','Location:','Test Location','Certificate:','AB12','2020-01-01','2099-12-31','2026-01-01','2026-11-01','Sign again','From','To','To sign: 1','already signed: 1','refused: 1','MY_STATE','Line 8','CALL: QG0TEST','DXCC: 291','US_STATE: ID','Cancel','Sign…'])expect(html).toContain(text);
 expect(html).not.toMatch(/id="again"[^>]*checked/);expect(electron.options[0].webPreferences).toMatchObject({sandbox:true,contextIsolation:true,nodeIntegration:false,devTools:false});
 const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};electron.ipc.emit('lotw:log-answer',{...event,sender:{}},true);expect(window.destroyed).toBe(false);electron.ipc.emit('lotw:log-answer',event,false);expect(await result).toBe(false);expect(electron.handlers.size).toBe(0);
});
it('serializes changes and refuses a Sign answer while its displayed preview is pending',async()=>{
 const done=Promise.withResolvers<NativeLotwLogPreview>();const update=vi.fn(()=>done.promise);const result=lotwLogDialogs('/dist').confirmSign('test.adi',p(),context,update);const window=electron.windows[0];const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
 const changing=electron.handlers.get('lotw:log-preview')!(event,{call:'QG0TEST',location:'test-location',certificate:cert.id,from:'',to:'',signAgain:true});await Promise.resolve();electron.ipc.emit('lotw:log-answer',event,true);expect(window.destroyed).toBe(false);done.resolve({...p(),signAgainCount:1});await changing;electron.ipc.emit('lotw:log-answer',event,true);expect(await result).toBe(true);
});
it('upload confirmation names the file, every certificate, counts and dates, defaulting to Cancel',()=>{
 const options=uploadConfirmation('test.tq8',p());for(const text of ['test.tq8','QG0TEST','AB12','3 QSOs','2026-01-01','2026-11-01'])expect(options.detail).toContain(text);expect(options.defaultId).toBe(0);expect(options.cancelId).toBe(0);
});
it('chooses only supported logs, saves beside the input and sends no cancelled path',async()=>{
 const dialogs=lotwLogDialogs('/dist');electron.choose.mockResolvedValue({canceled:true,filePaths:['/test-only/input.adi']});expect(await dialogs.choose(false)).toBeUndefined();expect(electron.choose).toHaveBeenCalledWith(expect.objectContaining({filters:[{name:'Log',extensions:['adi','adx','log']}]}));electron.save.mockResolvedValue({canceled:true,filePath:'/test-only/input.tq8'});expect(await dialogs.save('/test-only/input.adi')).toBeUndefined();expect(electron.save).toHaveBeenCalledWith(expect.objectContaining({defaultPath:join('/test-only','input.tq8')}));
});
it('escapes log metadata as text and abort removes the sender handlers',async()=>{
 const abort=new AbortController();const result=lotwLogDialogs('/dist').confirmSign('<planted>.adi',p(),context,vi.fn(),abort.signal);const html=decodeURIComponent(electron.windows[0].loadURL.mock.calls[0][0].slice('data:text/html,'.length));expect(html).toContain('&lt;planted&gt;');expect(logPreviewText(p())).toContain('Station fields sent to LoTW:');abort.abort();expect(await result).toBe(false);expect(electron.handlers.size).toBe(0);
});

it('keeps date exclusions separate from refusals in the preview and result',async()=>{
 const preview={...p(),outsideDates:2};
 expect(logPreviewText(preview)).toContain('Outside the dates: 2');
 expect(logPreviewText(preview)).toContain('refused: 1');
 electron.confirm.mockResolvedValue({response:0});
 await lotwLogDialogs('/dist').result({signed:1,alreadySigned:1,signAgainCount:0,outsideDates:2,refused:preview.refused},false);
 expect(electron.confirm).toHaveBeenCalledWith(expect.objectContaining({detail:expect.stringContaining('1 refused; 2 outside the dates.')}));
});
it('shows fixed Location guidance initially and after a refused update',async()=>{
 const message="Check the Location's DXCC entity before signing.";
 const update=vi.fn(async()=>{throw new Error(message);});
 const result=lotwLogDialogs('/dist').confirmSign('test.adi',{...p(),certificate:null},{...context,previewProblem:message},update);
 const window=electron.windows[0];
 const html=decodeURIComponent(window.loadURL.mock.calls[0][0].slice('data:text/html,'.length));
 expect(html).toContain('Check the Location&#39;s DXCC entity before signing.');
 const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
 const refresh=electron.handlers.get('lotw:log-preview')!;
 const selection={call:'QG0TEST',location:'test-location',certificate:'',from:'',to:'',signAgain:false};
 expect(await refresh(event,selection)).toEqual({text:message,certificates:[],selected:'',ready:false});
 electron.ipc.emit('lotw:log-answer',event,true);expect(window.destroyed).toBe(false);
 update.mockRejectedValueOnce(new Error('/qg-test/private-path input value'));
 expect(await refresh(event,selection)).toBeNull();
 electron.ipc.emit('lotw:log-answer',event,false);expect(await result).toBe(false);
});

it('styles the signing window only through a stylesheet the CSP names by hash',async()=>{
 const {createHash}=await import('node:crypto');
 const result=lotwLogDialogs('/dist').confirmSign('test.adi',p(),context,vi.fn());
 const window=electron.windows[0];
 const html=decodeURIComponent(window.loadURL.mock.calls[0][0].slice('data:text/html,'.length));
 const styles=[...html.matchAll(/<style>([^<]*)<\/style>/g)].map(m=>m[1]);
 expect(styles).toHaveLength(1);
 const csp=/Content-Security-Policy" content="([^"]*)"/.exec(html)![1];
 expect(csp).toContain(`style-src 'sha256-${createHash('sha256').update(styles[0]).digest('base64')}'`);
 expect(csp).toContain("script-src 'none'");
 expect(csp).not.toContain('unsafe');
 expect(html).not.toMatch(/ style="/);
 electron.ipc.emit('lotw:log-answer',{sender:window.webContents,senderFrame:window.webContents.mainFrame},false);
 expect(await result).toBe(false);
});
