// SPDX-License-Identifier: GPL-3.0-or-later
import { basename } from 'node:path';
import type { NativeLotwCommand, NativeLotwLogPreview, NativeLotwLogOutcome, NativeLotwSelection } from '../callsign-core/native.js';
import { isLotwLogPreview, isLotwLogOutcome, isLotwLocationMessage } from '../callsigns/lotw-contract.js';
import type { LotwLogResult } from '../extension-api/api-contract.js';
import type { Station } from '../storage/station-contract.js';
export interface LotwLogContext { calls: readonly { call: string }[]; activeCall: string; locations: readonly Station[]; activeLocation: string | null; previewProblem?: string }
export interface LotwLogPorts {
  core(command: NativeLotwCommand): Promise<unknown>;
  context(): Promise<LotwLogContext>;
  choose(upload: boolean, signal?: AbortSignal): Promise<string | undefined>;
  save(input: string, signal?: AbortSignal): Promise<string | undefined>;
  confirmSign(file: string, preview: NativeLotwLogPreview, context: LotwLogContext, update: (selection: NativeLotwSelection) => Promise<NativeLotwLogPreview>, signal?: AbortSignal): Promise<boolean>;
  confirmUpload(file: string, preview: NativeLotwLogPreview, signal?: AbortSignal): Promise<boolean>;
  result(outcome: NativeLotwLogOutcome, canUpload: boolean, signal?: AbortSignal): Promise<boolean>;
}
export function createLotwDialogGate() {
  let busy = false;
  let nativeDialogs = 0;
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    if (busy || nativeDialogs) throw new Error('Finish the open LoTW dialog first.');
    busy = true;
    try { return await work(); } finally { busy = false; }
  };
  return Object.assign(run, {
    async track<T>(open: () => Promise<T>): Promise<T> {
      nativeDialogs += 1;
      try { return await open(); } finally { nativeDialogs -= 1; }
    }
  });
}
export function createLotwLog(ports: LotwLogPorts) {
  let busy = false;
  return async (kind: 'lotw.sign' | 'lotw.upload', canUpload: () => boolean, signal?: AbortSignal): Promise<LotwLogResult> => {
    if (busy) throw new Error('Finish the open LoTW dialog first.');
    busy = true;
    let token: string | undefined;
    let inspecting = false;
    const cancelled: LotwLogResult = { status: 'cancelled', signed: 0, outsideDates: 0, alreadySigned: 0, signAgainCount: 0, refused: [], upload: null };
    let completed: LotwLogResult | undefined;
    const aborted = new Error('LoTW operation cancelled.');
    const check = () => { if (signal?.aborted) throw aborted; };
    const prompt = async <T>(work: () => Promise<T>): Promise<T> => {
      check();
      let stop = () => {};
      const cancellation = new Promise<never>((_resolve,reject) => { stop = () => reject(aborted); });
      signal?.addEventListener('abort',stop,{once:true});
      try { return await Promise.race([work(),cancellation]); } finally { signal?.removeEventListener('abort',stop); }
    };
    const inspect = async (path: string, upload: boolean) => {
      check(); inspecting = true;
      const reply = await ports.core({ op: upload ? 'uploadInspect' : 'logPrepare', path });
      if (!isLotwLogPreview(reply)) throw new Error('The log preview could not be read.');
      inspecting = false; token = reply.token; check(); return reply;
    };
    const upload = async (path?: string): Promise<string | null> => {
      if (!canUpload()) throw new Error('Upload to LoTW is not permitted.');
      const file = path ?? await prompt(() => ports.choose(true,signal));
      check(); if (!file) return null;
      const preview = await inspect(file,true);
      if (!await prompt(() => ports.confirmUpload(basename(file),preview,signal))) return null;
      check(); if (!canUpload()) throw new Error('Upload to LoTW is no longer permitted.');
      const answer = await ports.core({op:'uploadSend',token:token!}); token = undefined;
      if (typeof answer !== 'string' || answer.length > 4096) throw new Error('The upload outcome is unknown. Check LoTW before trying again.');
      return answer;
    };
    try {
      check();
      if (kind === 'lotw.upload') { const answer = await upload(); return answer === null ? cancelled : {...cancelled,status:'completed',upload:answer}; }
      const file = await prompt(() => ports.choose(false,signal)); check(); if (!file) return cancelled;
      let preview = await inspect(file,false);
      const context = await ports.context(); check();
      if (!context.calls.length || !context.locations.length) throw new Error('Add a callsign and Location before signing a log.');
      const location = context.locations.find(l => l.id===context.activeLocation) ?? context.locations[0];
      const selection: NativeLotwSelection = { call:context.activeCall || context.calls[0].call, place:{...location.place},park:location.lotwPark??'',certificate:'',from:'',to:'',signAgain:false };
      const update = async (s: NativeLotwSelection): Promise<NativeLotwLogPreview> => {
        check();
        // Only the main-owned dialog chooses among core-provided callsigns and Locations.
        if (!context.calls.some(c => c.call===s.call) || !context.locations.some(l => JSON.stringify(l.place)===JSON.stringify(s.place) && (l.lotwPark??'')===s.park)) throw new Error('Choose one of your callsigns and Locations.');
        const value = await ports.core({op:'logPreview',token:token!,selection:s});
        if (!isLotwLogPreview(value) || value.token!==token) throw new Error('The log preview could not be read.');
        preview = value; check(); return value;
      };
      try { preview = await update(selection); } catch (error) { check(); if (error instanceof Error && isLotwLocationMessage(error.message)) context.previewProblem = error.message; }
      if (!await prompt(() => ports.confirmSign(basename(file),preview,context,update,signal))) return cancelled;
      check(); if (!preview.certificate || preview.toSign===0) throw new Error('Choose a certificate and at least one QSO to sign.');
      const output = await prompt(() => ports.save(file,signal)); check(); if (!output) return cancelled;
      const outcome = await ports.core({op:'logSign',token:token!,path:output}); token=undefined;
      if (!isLotwLogOutcome(outcome)) throw new Error('The signing outcome could not be read. Check the output before signing again.');
      completed = {...outcome,status:'completed',upload:null};
      check();
      // A separate explicit press and a new inspection/confirmation are required to upload.
      if (await prompt(() => ports.result(outcome,canUpload(),signal))) completed = { ...completed, upload: await upload(output) };
      return completed;
    } catch (error) { if (error===aborted) return completed ?? cancelled; throw error; }
    finally {
      if (token) { try { await ports.core({op:'logCancel',token}); } catch { /* Already consumed. */ } }
      else if (inspecting) { try { await ports.core({op:'logDiscard'}); } catch { /* Worker exit discards it. */ } }
      busy=false;
    }
  };
}
