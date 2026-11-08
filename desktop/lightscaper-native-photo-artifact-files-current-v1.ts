/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { photoNativeRelativeCurrentV1, type PhotoNativeFileCurrentV1 } from '../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
const UNRETIRED = new Set<object>(), FAILURES = new WeakSet<object>();
export function photoNativeArtifactRetirementIsUnprovedCurrentV1(value: unknown): boolean { return typeof value === 'object' && value !== null && FAILURES.has(value); }
export function photoNativeAbsoluteCurrentV1(value: unknown): string {
 if (typeof value !== 'string' || !value || value.includes('\0') || !isAbsolute(value)) throw new TypeError('Photo native owner requires an absolute private root.'); return resolve(value);
}
export async function photoNativeDirectoryCurrentV1(value: unknown): Promise<string> {
 const path = photoNativeAbsoluteCurrentV1(value), details = await lstat(path);
 if (!details.isDirectory() || details.isSymbolicLink()) throw new TypeError('Photo native root must be a real directory.');
 const actual = await realpath(path); if (process.platform === 'win32' ? actual.toLowerCase() !== path.toLowerCase() : actual !== path) throw new TypeError('Photo native root is not canonical.'); return actual;
}
function equalStamp(a: Awaited<ReturnType<FileHandle['stat']>>, b: Awaited<ReturnType<FileHandle['stat']>>): boolean {
 return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
export async function openPhotoNativePinnedFileCurrentV1(rootValue: string, pin: PhotoNativeFileCurrentV1) {
 const root = await photoNativeDirectoryCurrentV1(rootValue), name = photoNativeRelativeCurrentV1(pin.path), path = join(root, name);
 let parent = root;
 for (const component of name.split('/').slice(0, -1)) { parent = join(parent, component); const info = await lstat(parent); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Photo native artifact ancestor is not a real directory.'); }
 const before = await lstat(path);
 if (!before.isFile() || before.isSymbolicLink() || before.size !== pin.byteLength) throw new Error('Photo native artifact length/type differs from its pin.');
 const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
 let close: Promise<void> | undefined;
 const owned = Object.freeze({ handle, path, pin, close(): Promise<void> {
  if (close) return close;
  let accept!: () => void, reject!: (reason: unknown) => void; close = new Promise<void>((yes, no) => { accept = yes; reject = no; });
  void handle.close().then(accept, (reason: unknown) => { UNRETIRED.add(owned); const failure = new AggregateError([reason], 'Photo native artifact handle retirement is unproved.'); FAILURES.add(failure); reject(failure); }); return close;
 } });
 try {
  const opened = await handle.stat(); if (!opened.isFile() || !equalStamp(before, opened)) throw new Error('Photo native artifact changed while opened.');
  const hash = createHash('sha256'), bytes = Buffer.alloc(Math.min(1048576, pin.byteLength)); let offset = 0;
  try { while (offset < pin.byteLength) { const count = Math.min(bytes.byteLength, pin.byteLength - offset), part = await handle.read(bytes, 0, count, offset); if (part.bytesRead !== count) throw new Error('Photo native artifact ended early.'); hash.update(bytes.subarray(0, count)); offset += count; }
   const extra = Buffer.alloc(1); if ((await handle.read(extra, 0, 1, offset)).bytesRead || hash.digest('hex') !== pin.sha256 || !equalStamp(opened, await handle.stat())) throw new Error('Photo native artifact digest/stamp differs from its pin.');
  } finally { bytes.fill(0); }
  return owned;
 } catch (primary) { try { await owned.close(); } catch (cleanup) { const failure = new AggregateError([primary, cleanup], 'Photo native authentication and handle retirement failed.'); FAILURES.add(failure); throw failure; } throw primary; }
}
export async function readPhotoNativePinnedFileCurrentV1(root: string, pin: PhotoNativeFileCurrentV1): Promise<Buffer> {
 if (pin.byteLength > 2 * 1024 * 1024) throw new RangeError('Photo native control file exceeds its decode bound.');
 const owned = await openPhotoNativePinnedFileCurrentV1(root, pin); let failed = false, primary: unknown, bytes: Buffer | undefined;
 try { const stamp = await owned.handle.stat(); bytes = Buffer.alloc(pin.byteLength); let offset = 0; while (offset < bytes.byteLength) { const part = await owned.handle.read(bytes, offset, bytes.byteLength - offset, offset); if (!part.bytesRead) throw new Error('Photo native control file ended early.'); offset += part.bytesRead; } if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256 || !equalStamp(stamp, await owned.handle.stat())) throw new Error('Photo native control file changed during capture.'); }
 catch (error) { failed = true; primary = error; }
 try { await owned.close(); } catch (cleanup) { bytes?.fill(0); if (failed) { const failure = new AggregateError([primary, cleanup], 'Photo native read and retirement failed.'); FAILURES.add(failure); throw failure; } throw cleanup; }
 if (failed) { bytes?.fill(0); throw primary; } return bytes!;
}
export async function photoNativeInventoryCurrentV1(rootValue: string): Promise<readonly PhotoNativeFileCurrentV1[]> {
 const root = await photoNativeDirectoryCurrentV1(rootValue), files: PhotoNativeFileCurrentV1[] = []; let nodes = 0, total = 0;
 async function visit(path: string): Promise<void> {
  const before = files.length;
  for (const entry of await readdir(path, { withFileTypes: true })) {
   if (++nodes > 1024) throw new RangeError('Photo native closure node capacity exceeded.');
   const full = join(path, entry.name), name = photoNativeRelativeCurrentV1(relative(root, full).split(sep).join('/')), details = await lstat(full);
   if (details.isSymbolicLink()) throw new Error('Photo native closure refuses symbolic links.');
   if (details.isDirectory()) await visit(full);
   else if (details.isFile() && details.size > 0 && details.size <= 64 * 1024 * 1024 && files.length < 256 && (total += details.size) <= 256 * 1024 * 1024) {
    const file = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)), hash = createHash('sha256'), bytes = Buffer.alloc(Math.min(1048576, details.size));
    let failed = false, primary: unknown;
    try { const before = await file.stat(); if (!equalStamp(details, before)) throw new Error('Photo native inventory changed while opened.'); let offset = 0;
     while (offset < details.size) { const count = Math.min(bytes.byteLength, details.size - offset), part = await file.read(bytes, 0, count, offset); if (part.bytesRead !== count) throw new Error('Photo native inventory ended early.'); hash.update(bytes.subarray(0, count)); offset += count; }
     if (!equalStamp(before, await file.stat())) throw new Error('Photo native inventory changed while hashing.');
    } catch (error) { failed = true; primary = error; } finally { bytes.fill(0); }
    try { await file.close(); } catch (cleanup) { const witness = { file, path: full }; UNRETIRED.add(witness); const failure = new AggregateError([...(failed ? [primary] : []), cleanup], 'Photo native inventory and retirement failed.'); FAILURES.add(failure); throw failure; }
    if (failed) throw primary; files.push(Object.freeze({ path: name, byteLength: details.size, sha256: hash.digest('hex') }));
   } else throw new RangeError('Photo native closure has an unsupported or oversized member.');
  }
  if (path !== root && files.length === before) throw new Error('Photo native closure contains an unowned empty directory.');
 }
 await visit(root); return Object.freeze(files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
export async function copyPhotoNativePinnedFileCurrentV1(root: string, pin: PhotoNativeFileCurrentV1, destination: string) {
 const input = await openPhotoNativePinnedFileCurrentV1(root, pin); let output: FileHandle | undefined, failed = false, primary: unknown;
 const bytes = Buffer.alloc(Math.min(1048576, pin.byteLength)); let stamp: Awaited<ReturnType<FileHandle['stat']>> | undefined;
 try { await mkdir(dirname(destination), { recursive: true }); output = await open(destination, 'wx', pin.path.startsWith('bin/') ? 0o755 : 0o644); let offset = 0;
  while (offset < pin.byteLength) { const count = Math.min(bytes.byteLength, pin.byteLength - offset), part = await input.handle.read(bytes, 0, count, offset); if (part.bytesRead !== count) throw new Error('Photo native copy ended early.'); let written = 0;
   while (written < count) { const result = await output.write(bytes, written, count - written, offset + written); if (!result.bytesWritten) throw new Error('Photo native copy stalled.'); written += result.bytesWritten; } offset += count; }
  await output.sync(); stamp = await output.stat();
 } catch (error) { failed = true; primary = error; } finally { bytes.fill(0); }
 const errors: unknown[] = [];
 for (const owner of [output, input]) if (owner) { try { await owner.close(); } catch (error) { errors.push(error); UNRETIRED.add(owner); } }
 if (errors.length) { const failure = new AggregateError([...(failed ? [primary] : []), ...errors], 'Photo native copy retirement failed.'); FAILURES.add(failure); throw failure; } if (failed) throw primary; return stamp!;
}

export async function readPhotoNativeControlFileCurrentV1(path: string, maximum = 2 * 1024 * 1024): Promise<Buffer> {
 const before = await lstat(path); if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum) throw new RangeError('Photo native control file type/length is invalid.');
 const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); let bytes: Buffer | undefined, failed = false, primary: unknown;
 try { const opened = await file.stat(); if (!equalStamp(before, opened)) throw new Error('Photo native control file changed while opened.'); bytes = Buffer.alloc(before.size); let offset = 0;
  while (offset < bytes.length) { const part = await file.read(bytes, offset, bytes.length - offset, offset); if (!part.bytesRead) throw new Error('Photo native control file ended early.'); offset += part.bytesRead; }
  const extra = Buffer.alloc(1); if ((await file.read(extra, 0, 1, offset)).bytesRead || !equalStamp(opened, await file.stat())) throw new Error('Photo native control file changed during capture.');
 } catch (error) { failed = true; primary = error; }
 try { await file.close(); } catch (cleanup) { bytes?.fill(0); UNRETIRED.add({ file, path }); const failure = new AggregateError([...(failed ? [primary] : []), cleanup], 'Photo native control handle retirement failed.'); FAILURES.add(failure); throw failure; }
 if (failed) { bytes?.fill(0); throw primary; } return bytes!;
}
