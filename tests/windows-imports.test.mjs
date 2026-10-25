// SPDX-License-Identifier: GPL-3.0-only
// The Windows import check (#91), on a synthetic executable built here: its
// imports and delay-loaded imports are read, and an import that is neither
// Windows, the Visual C++ runtime nor shipped is caught.
import { describe, expect, it } from 'vitest';
import { allowed, imports } from '../scripts/windows-imports.mjs';

// A minimal 64-bit PE: headers, one section at RVA 0x1000 (file offset
// 0x200) holding the import descriptors, the delay-import descriptors and
// the DLL names.
function pe({ imported = [], delayed = [], magic = 0x20b } = {}) {
  const buffer = Buffer.alloc(0x1000);
  buffer.writeUInt16LE(0x5a4d, 0);
  const at = 0x40;
  buffer.writeUInt32LE(at, 0x3c);
  buffer.writeUInt32LE(0x4550, at);
  buffer.writeUInt16LE(1, at + 6); // one section
  const optionalSize = magic === 0x20b ? 240 : 224;
  buffer.writeUInt16LE(optionalSize, at + 20);
  const optional = at + 24;
  buffer.writeUInt16LE(magic, optional);
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const section = optional + optionalSize;
  buffer.writeUInt32LE(0x1000, section + 8); // VirtualSize
  buffer.writeUInt32LE(0x1000, section + 12); // VirtualAddress
  buffer.writeUInt32LE(0x800, section + 16); // SizeOfRawData
  buffer.writeUInt32LE(0x200, section + 20); // PointerToRawData
  const rva = offset => offset - 0x200 + 0x1000;
  let names = 0x600;
  const nameAt = dll => { const offset = names; buffer.write(`${dll}\0`, offset, 'latin1'); names += dll.length + 1; return rva(offset); };
  const importTable = 0x200;
  imported.forEach((dll, i) => buffer.writeUInt32LE(nameAt(dll), importTable + i * 20 + 12));
  if (imported.length > 0) buffer.writeUInt32LE(rva(importTable), directories + 1 * 8);
  const delayTable = 0x400;
  delayed.forEach((dll, i) => buffer.writeUInt32LE(nameAt(dll), delayTable + i * 32 + 4));
  if (delayed.length > 0) buffer.writeUInt32LE(rva(delayTable), directories + 13 * 8);
  return buffer;
}

describe('Windows imports (#91)', () => {
  it('reads the imports and the delay-loaded imports, in lower case', () => {
    expect(imports(pe({ imported: ['KERNEL32.dll', 'VCRUNTIME140.dll'], delayed: ['Shell32.dll'] })))
      .toEqual(['kernel32.dll', 'shell32.dll', 'vcruntime140.dll']);
  });

  it('reads a 32-bit executable too', () => {
    expect(imports(pe({ imported: ['ws2_32.dll'], magic: 0x10b }))).toEqual(['ws2_32.dll']);
  });

  it('refuses a file that is not a Windows executable', () => {
    expect(() => imports(Buffer.from('#!/bin/sh\n'.padEnd(80)))).toThrow(/not a Windows executable/);
  });

  it('allows Windows, the Visual C++ runtime, API sets and what is shipped; nothing else', () => {
    const shipped = new Set(['aws_lc_fips_0_14_2_crypto.dll']);
    for (const dll of ['kernel32.dll', 'vcruntime140.dll', 'api-ms-win-crt-heap-l1-1-0.dll', 'aws_lc_fips_0_14_2_crypto.dll']) {
      expect(allowed(dll, shipped)).toBe(true);
    }
    // The planted cases: a third-party DLL nobody ships, and the runtime
    // taken off the list, as CI does to prove the check can fail.
    expect(allowed('libssl-3-x64.dll', shipped)).toBe(false);
    expect(allowed('vcruntime140.dll', shipped, new Set(['vcruntime140.dll']))).toBe(false);
  });
});
