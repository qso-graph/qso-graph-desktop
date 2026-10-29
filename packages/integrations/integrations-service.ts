// SPDX-License-Identifier: GPL-3.0-only
// Integrations' process (QGD-INT-0001, QGD-PRC-0004): Electron wiring only;
// what it does is integrations.ts, tested in process.
//
// Started by the broker as a utility process with one argument, the limits
// file, which is the application's own and never a user's. It holds no
// credential, reads no file but that one, writes none, and opens no
// connection of its own.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeIntegrations } from '../integrations-core/native.js';
import { createForwardingLogger } from '../logging/logger.js';
import { createIntegrations } from './integrations.js';
import { parseIntegrationLimits } from './integration-limits.js';
import type { FromIntegrations } from './integration-contract.js';

const require = createRequire(import.meta.url);
// dist/integrations/integrations-service.js: the addon is in dist/native,
// beside it (build-native.mjs).
const native = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'integrations.node')) as NativeIntegrations;
const parent = process.parentPort;
const post = (message: FromIntegrations) => parent.postMessage(message);
const log = createForwardingLogger('integrations', line => post({ type: 'log', line }));
// Read once, and checked whole: no limits, no listening.
const limits = parseIntegrationLimits(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const integrations = createIntegrations({ native, limits, post });
log.info({}, 'integrations started');
// On close every port is closed and the broker told, and the broker ends the
// process once it has heard.
parent.on('message', event => integrations.receive(event.data));
