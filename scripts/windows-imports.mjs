// SPDX-License-Identifier: GPL-3.0-only
// Every DLL our own Windows native files import is part of Windows, part of
// Microsoft's Visual C++ runtime, or shipped beside them (#91). The Visual
// C++ runtime is missing on a freshly installed Windows 11, which is how the
// credential core failed to start for every new user of 0.2.0 while every CI
// test passed: GitHub's runners always have it. The installer and the Store
// package now bring Microsoft's runtime; this keeps the next native
// dependency from slipping through the same way.
//
//   node scripts/windows-imports.mjs <folder> [--without <dll>]...
//
// Reads each .node and .dll under the folder (the packaged application's
// app.asar.unpacked), its imports and its delay-loaded imports. --without
// takes a DLL off the allowed list, so CI can prove the check fails.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

// Windows's own DLLs our files may use. Narrow on purpose: a new one is a
// decision, made here, with its reason.
export const WINDOWS = new Set([
  'kernel32.dll', 'ntdll.dll', 'advapi32.dll', 'user32.dll', 'ws2_32.dll', 'bcrypt.dll',
  'bcryptprimitives.dll', 'crypt32.dll', 'ncrypt.dll', 'secur32.dll', 'ole32.dll', 'oleaut32.dll',
  'shell32.dll', 'userenv.dll', 'version.dll', 'iphlpapi.dll', 'psapi.dll', 'rpcrt4.dll', 'shlwapi.dll'
]);
// Microsoft's Visual C++ runtime: what vc_redist.x64.exe and the Store's
// Microsoft.VCLibs.140.00.UWPDesktop provide.
export const VC_RUNTIME = new Set(['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll']);

// The import and delay-import tables of a PE file (an .exe, .dll or .node).
export function imports(buffer) {
  if (buffer.length < 64 || buffer.readUInt16LE(0) !== 0x5a4d) throw new Error('not a Windows executable (no MZ header)');
  const pe = buffer.readUInt32LE(0x3c);
  if (buffer.readUInt32LE(pe) !== 0x4550) throw new Error('not a Windows executable (no PE header)');
  const sections = buffer.readUInt16LE(pe + 6);
  const optionalSize = buffer.readUInt16LE(pe + 20);
  const optional = pe + 24;
  const magic = buffer.readUInt16LE(optional);
  const directories = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : NaN);
  if (Number.isNaN(directories)) throw new Error('not a Windows executable (unknown optional header)');
  const table = optional + optionalSize;
  const offset = rva => {
    for (let i = 0; i < sections; i += 1) {
      const at = table + i * 40;
      const virtual = buffer.readUInt32LE(at + 12);
      const size = Math.max(buffer.readUInt32LE(at + 8), buffer.readUInt32LE(at + 16));
      if (rva >= virtual && rva < virtual + size) return rva - virtual + buffer.readUInt32LE(at + 20);
    }
    throw new Error(`address ${rva} is in no section`);
  };
  const name = rva => {
    const start = offset(rva);
    const end = buffer.indexOf(0, start);
    return buffer.toString('latin1', start, end);
  };
  const found = new Set();
  const read = (index, size, field) => {
    const rva = buffer.readUInt32LE(directories + index * 8);
    if (rva === 0) return;
    for (let at = offset(rva); ; at += size) {
      const nameRva = buffer.readUInt32LE(at + field);
      if (nameRva === 0) break;
      found.add(name(nameRva).toLowerCase());
    }
  };
  read(1, 20, 12); // imports: IMAGE_IMPORT_DESCRIPTOR, Name at 12
  read(13, 32, 4); // delay imports: IMAGE_DELAYLOAD_DESCRIPTOR, DllNameRVA at 4
  return [...found].sort();
}

export function allowed(dll, shipped, without = new Set()) {
  if (without.has(dll)) return false;
  return WINDOWS.has(dll) || VC_RUNTIME.has(dll) || shipped.has(dll) || /^(api|ext)-ms-win-[a-z0-9-]+\.dll$/.test(dll);
}

function natives(folder) {
  const found = [];
  const walk = directory => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(node|dll)$/i.test(entry)) found.push(path);
    }
  };
  walk(folder);
  return found.sort();
}

export function check(folder, without = new Set()) {
  const files = natives(folder);
  const shipped = new Set(files.map(file => basename(file).toLowerCase()));
  const problems = [];
  for (const file of files) {
    for (const dll of imports(readFileSync(file))) {
      if (!allowed(dll, shipped, without)) problems.push(`${basename(file)} imports ${dll}`);
    }
  }
  return { files, problems };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [folder, ...rest] = process.argv.slice(2);
  const without = new Set();
  for (let i = 0; i < rest.length; i += 1) if (rest[i] === '--without') without.add(String(rest[++i]).toLowerCase());
  const { files, problems } = check(folder, without);
  // A folder with nothing to read must fail: a check that finds nothing has
  // checked nothing (AGENTS.md).
  if (files.length === 0) { console.error(`No .node or .dll under ${folder}.`); process.exit(1); }
  for (const file of files) console.log(`${basename(file)}: ${imports(readFileSync(file)).join(', ')}`);
  if (problems.length > 0) {
    console.error('Imports that are neither part of Windows nor Microsoft\'s Visual C++ runtime, nor shipped beside them:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`Windows imports: ${files.length} native files, every import part of Windows, the Visual C++ runtime, or shipped.`);
}
