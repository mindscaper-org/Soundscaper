/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { photoNativeAbsoluteCurrentV1 as absolute, photoNativeDirectoryCurrentV1 as directory, readPhotoNativeControlFileCurrentV1 as control } from './lightscaper-native-photo-artifact-files-current-v1.ts';
const MANIFEST = 'config/lightscaper-native-photo-payload-current-v1.json', MAXIMUM = 2 * 1024 * 1024;
/** Electron virtualizes an ASAR root as a directory. Only its unpatched
 * filesystem can select/prove the physical archive. Fixed member IO stays
 * patched and bounded; external helper files retain real nofollow SHA pins. */
export async function readPhotoNativeApplicationManifestCurrentV1(value: string): Promise<Buffer> {
 const root = absolute(value);
 let physical = { lstat, realpath };
 if (process.versions.electron) {
  const moduleId = 'node:original-fs';
  physical = (await import(moduleId) as typeof import('node:fs')).promises;
 }
 const before = await physical.lstat(root);
 // A real directory, even one named .asar, keeps ordinary nofollow admission.
 if (before.isDirectory()) return control(join(await directory(root), MANIFEST));
 if (!root.endsWith('.asar') || !before.isFile() || before.isSymbolicLink() || await physical.realpath(root) !== root) throw new TypeError('Photo protected application root must be the real app directory or authenticated ASAR.');
 const path = join(root, MANIFEST), member = await lstat(path);
 if (!member.isFile() || member.isSymbolicLink() || member.size < 1 || member.size > MAXIMUM) throw new RangeError('Photo ASAR manifest exceeds its fixed bound.');
 let bytes: Buffer | undefined;
 try {
  bytes = await readFile(path);
  const after = await physical.lstat(root), finalMember = await lstat(path);
  if (bytes.byteLength !== member.size || !after.isFile() || after.isSymbolicLink() || await physical.realpath(root) !== root
   || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mode !== after.mode || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
   || !finalMember.isFile() || finalMember.isSymbolicLink() || member.size !== finalMember.size) throw new Error('Photo protected ASAR changed during manifest admission.');
  return bytes;
 } catch (error) { bytes?.fill(0); throw error; }
}
