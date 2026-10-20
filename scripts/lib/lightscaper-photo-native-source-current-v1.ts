/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { list } from 'tar';
import pin from '../../config/lightscaper-libraw-runtime-manifest.json' with { type: 'json' };
import { openPhotoNativePinnedFileCurrentV1 as authenticate, photoNativeDirectoryCurrentV1 as directory,
 readPhotoNativeControlFileCurrentV1 as control, readPhotoNativePinnedFileCurrentV1 as read } from '../../desktop/lightscaper-native-photo-artifact-files-current-v1.ts';
import { photoNativeRelativeCurrentV1 as path, photoNativeRecordCurrentV1 as record, type PhotoNativeFileCurrentV1 } from '../../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
import { runPhotoNativeToolCurrentV1 as tool } from './lightscaper-photo-native-tool-current-v1.ts';
export const PHOTO_NATIVE_SOURCE_MANIFEST_CURRENT_V1 = 'native/lightscaper-photo-native-current-v1/source-manifest.json';
export async function capturePhotoNativeSourcesCurrentV1(repositoryRoot: string, revision: string | null, signal?: AbortSignal) {
 const root = await directory(repositoryRoot), bytes = await control(join(root, PHOTO_NATIVE_SOURCE_MANIFEST_CURRENT_V1)); let parsed: unknown;
 try { parsed = JSON.parse(bytes.toString('utf8')) as unknown; } finally { bytes.fill(0); }
 const source = record(parsed, ['schemaVersion', 'id', 'targets', 'files']);
 if (source.schemaVersion !== 1 || source.id !== 'lightscaper-photo-native-current-v1' || !Array.isArray(source.files) || source.files.length < 20 || source.files.length > 128
  || JSON.stringify(source.targets) !== JSON.stringify(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].map(id => ({ id, status: 'ci-generated' })))) throw new Error('Photo native owning source plan is invalid.');
 const names = source.files.map(path); if (new Set(names).size !== names.length || !names.includes(PHOTO_NATIVE_SOURCE_MANIFEST_CURRENT_V1)) throw new Error('Photo native owning source plan is duplicate or unbound.');
 if (revision !== null) {
  if (!/^[a-f0-9]{40}$/u.test(revision) || (await tool('git', ['-C', root, 'rev-parse', 'HEAD'], signal)).trim() !== revision) throw new Error('Photo native source revision is not actual HEAD.');
  const tracked = (await tool('git', ['-C', root, 'ls-files', '--', ...names], signal)).trim().split(/\r?\n/u).sort();
  if (JSON.stringify(tracked) !== JSON.stringify([...names].sort())) throw new Error('Production Photo source closure contains untracked/missing files.');
  await tool('git', ['-C', root, 'diff', '--exit-code', revision, '--', ...names], signal);
 }
 const files: PhotoNativeFileCurrentV1[] = [];
 for (const name of [...names].sort()) {
  const bytes = await control(join(root, name), 2 * 1024 * 1024);
  try { files.push(Object.freeze({ path: name, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') })); } finally { bytes.fill(0); }
 }
 const encoded = Buffer.from(`${JSON.stringify({ schemaVersion: 1, files })}\n`), sha256 = createHash('sha256').update(encoded).digest('hex');
 return Object.freeze({ root, files: Object.freeze(files), encoded, sha256 });
}
/** Compare the complete caller-supplied extraction with the authenticated
 * committed upstream archive. A folder name or Makefile alone is no proof. */
export async function authenticatePhotoLibrawSourceCurrentV1(repositoryRoot: string, sourceRoot: string): Promise<string> {
 const repository = await directory(repositoryRoot), root = await directory(sourceRoot), archive = pin.upstream.sourceArchive;
 const archiveBytes = await read(repository, archive);
 const expected = new Map<string, PhotoNativeFileCurrentV1>(), admitted = new Set<string>(), pending: Promise<void>[] = [];
 const cancelEntries = new Set<(error: unknown) => void>(); let count = 0, total = 0, failed = false, failure: unknown;
 const fail = (error: unknown): void => { if (!failed) { failed = true; failure = error; } };
 const parser = list({ strict: true, maxDecompressionRatio: 128, onReadEntry(entry) {
  try {
   const directoryEntry = entry.type === 'Directory';
   const name = directoryEntry && entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path;
   if (!name.startsWith('LibRaw-0.22.2') || name.split('/')[0] !== 'LibRaw-0.22.2' || name.includes('\\') || name.includes('\0')
    || name.split('/').some(part => !part || part === '.' || part === '..') || !['File', 'Directory'].includes(entry.type)
    || ++count > 512 || !Number.isSafeInteger(entry.size) || entry.size < 0 || (total += entry.size) > 16 * 1024 * 1024) throw new Error('Photo native upstream source archive is outside its closed bound.');
   if (directoryEntry) { if (entry.size !== 0) throw new Error('Native source directory carries a foreign body.'); return; }
   const relativePath = path(name.slice('LibRaw-0.22.2/'.length)); if (admitted.has(relativePath)) throw new Error('Duplicate native upstream source member.'); admitted.add(relativePath);
   const hash = createHash('sha256'); let length = 0;
   const operation = new Promise<void>((resolve, reject) => {
    const refuse = (error: unknown): void => { fail(error); cancelEntries.delete(refuse); reject(error); }; cancelEntries.add(refuse);
    entry.on('data', (bytes: Buffer) => { try { length += bytes.byteLength; if (length > entry.size) throw new Error('Upstream source member exceeded its bound.'); hash.update(bytes); } catch (error) { refuse(error); } });
    entry.once('error', refuse); entry.once('end', () => { try { if (length !== entry.size) throw new Error('Upstream source member was truncated.');
     expected.set(relativePath, Object.freeze({ path: relativePath, byteLength: length, sha256: hash.digest('hex') })); cancelEntries.delete(refuse); resolve(); } catch (error) { refuse(error); } });
   }); void operation.catch(() => undefined); pending.push(operation);
  } catch (error) { fail(error); }
  finally { entry.resume(); }
 } });
 try {
  await new Promise<void>((resolve, reject) => {
   parser.once('error', (error: unknown) => { fail(error); for (const cancel of [...cancelEntries]) cancel(error); reject(error); });
   parser.once('end', resolve);
   try { parser.end(archiveBytes); } catch (error) { fail(error); for (const cancel of [...cancelEntries]) cancel(error); reject(error); }
  }).catch((error: unknown) => { fail(error); });
  await Promise.allSettled(pending); if (failed) throw failure;
 } finally { archiveBytes.fill(0); }
 const found = new Set<string>(); let nodes = 0;
 async function visit(parent: string): Promise<void> {
  for (const entry of await readdir(parent, { withFileTypes: true })) {
   if (++nodes > 1024) throw new RangeError('Native upstream source extraction is oversized.');
   const full = join(parent, entry.name), details = await lstat(full), name = relative(root, full).split(sep).join('/');
   if (details.isSymbolicLink()) throw new Error('Native upstream source extraction contains a link.');
   if (details.isDirectory()) await visit(full);
   else { const pin = expected.get(name); if (!details.isFile() || !pin) throw new Error('Native upstream extraction has a foreign member.'); const actual = await authenticate(root, pin); await actual.close(); found.add(name); }
  }
 }
 await visit(root); if (found.size !== expected.size || found.size < 100) throw new Error('Native upstream source extraction is incomplete.'); return root;
}
