/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { photoNativeAbsoluteCurrentV1 as absolute, photoNativeDirectoryCurrentV1 as directory, readPhotoNativeControlFileCurrentV1 as control } from './lightscaper-native-photo-artifact-files-current-v1.ts';
const MANIFEST = 'config/lightscaper-native-photo-payload-current-v1.json', MAXIMUM = 2 * 1024 * 1024;
/** Electron's authenticated app ASAR is a file, not an external payload
 * directory. The fixed member is bounded before its actual ASAR read. External
 * helper bytes still use real nofollow FileHandles and whole-file SHA pins. */
export async function readPhotoNativeApplicationManifestCurrentV1(value: string): Promise<Buffer> {
 const root = absolute(value), before = await lstat(root);
 if (before.isDirectory()) return control(join(await directory(root), MANIFEST));
 if (!root.endsWith('.asar') || !before.isFile() || before.isSymbolicLink() || await realpath(root) !== root) throw new TypeError('Photo protected application root must be the real app directory or authenticated ASAR.');
 const path = join(root, MANIFEST), member = await lstat(path);
 if (!member.isFile() || member.isSymbolicLink() || member.size < 1 || member.size > MAXIMUM) throw new RangeError('Photo ASAR manifest exceeds its fixed bound.');
 const bytes = await readFile(path), after = await lstat(root), finalMember = await lstat(path);
 if (bytes.byteLength !== member.size || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || member.size !== finalMember.size) { bytes.fill(0); throw new Error('Photo protected ASAR changed during manifest admission.'); }
 return bytes;
}
