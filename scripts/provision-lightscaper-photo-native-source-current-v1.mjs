#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdir, lstat, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { extract } from 'tar';
import pin from '../config/lightscaper-libraw-runtime-manifest.json' with { type: 'json' };
import { readPhotoNativePinnedFileCurrentV1 as read, photoNativeDirectoryCurrentV1 as directory } from '../desktop/lightscaper-native-photo-artifact-files-current-v1.ts';
import { authenticatePhotoLibrawSourceCurrentV1 as authenticate } from './lib/lightscaper-photo-native-source-current-v1.ts';
const { values } = parseArgs({ options: { root: { type: 'string', default: '.' }, output: { type: 'string' } }, strict: true });
if (!values.output) throw new TypeError('Supply an absent output directory for the authenticated committed LibRaw source.');
const root = await directory(resolve(values.root)), output = resolve(values.output), bytes = await read(root, pin.upstream.sourceArchive);
await mkdir(output); const owned = await lstat(output); let failed = false, primary;
try {
 let count = 0, total = 0;
 const parser = extract({ cwd: output, strip: 1, strict: true, noMtime: true, filter(path, entry) {
  if (path.replace(/\/$/u, '') === 'LibRaw-0.22.2' && entry.type === 'Directory') return false;
  if (!path.startsWith('LibRaw-0.22.2/') || path.includes('\\') || path.includes('\0') || path.split('/').some(part => part === '..' || part === '.') || !['File', 'Directory'].includes(entry.type) || ++count > 512 || (total += entry.size) > 16 * 1024 * 1024) throw new Error('Authenticated native source extraction escaped its fixed closure.');
  return true;
 } });
 await new Promise((resolve, reject) => { let failure; parser.on('error', error => { failure ??= error; }); parser.once('close', () => { if (failure !== undefined) reject(failure); else resolve(); }); parser.end(bytes); });
 await authenticate(root, output);
} catch (error) { failed = true; primary = error; } finally { bytes.fill(0); }
if (failed) {
 try { const now = await lstat(output); if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== owned.dev || now.ino !== owned.ino) throw new Error('Owned source extraction directory was replaced.'); await rm(output, { recursive: true }); }
 catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native source extraction and owned cleanup failed.', { cause: cleanup }); } throw primary;
}
console.log(join(output));
