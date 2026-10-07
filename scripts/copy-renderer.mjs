// SPDX-License-Identifier: GPL-3.0-only
import { cp } from 'node:fs/promises';
await cp('src/renderer', 'dist/renderer', { recursive: true });
