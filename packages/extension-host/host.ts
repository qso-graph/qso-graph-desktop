// SPDX-License-Identifier: GPL-3.0-only
// QG Extensions: the extension host process (QGD-APP-0015). Electron wiring
// only; the runtime is runtime.ts, tested in process.
//
// Started by the extension broker as a utility process, it runs extension
// code and nothing else. Lifecycle messages come on the parent port; each
// extension's channel arrives as a transferred port with its `load`.
import { pathToFileURL } from 'node:url';
import type { MessagePortMain } from 'electron';
import { createHostRuntime } from './runtime.js';
import type { Port } from './protocol.js';

const parent = process.parentPort;

function adapt(port: MessagePortMain): Port {
  return {
    post: message => port.postMessage(message),
    onMessage: listener => { port.on('message', event => listener(event.data)); port.start(); },
    close: () => port.close()
  };
}

const runtime = createHostRuntime({
  // The one dynamic import in the product. Its path is never input: the
  // broker builds it from the application package and a validated manifest
  // (QGD-APP-0017), and only for an extension shipped in that package.
  // eslint-disable-next-line no-restricted-syntax -- QGD-APP-0015: the extension host loads extension code; the path is the core's, never an extension's.
  importModule: entry => import(pathToFileURL(entry).href),
  toBroker: message => parent.postMessage(message)
});

parent.on('message', event => {
  const port = event.ports?.[0];
  runtime.receive(event.data, port ? adapt(port) : undefined);
});
