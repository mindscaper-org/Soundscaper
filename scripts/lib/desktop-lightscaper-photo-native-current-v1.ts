/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { photoNativeInventoryCurrentV1 as inventory, readPhotoNativeControlFileCurrentV1 as control } from '../../desktop/lightscaper-native-photo-artifact-files-current-v1.ts';
import { readLightscaperPhotoNativeBuildResultCurrentV1 as read, photoNativePathsCurrentV1 as paths, type PhotoNativeBuildCurrentV1 } from '../../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
import { capturePhotoNativeSourcesCurrentV1 as sources } from './lightscaper-photo-native-source-current-v1.ts';
import { verifyPhotoNativeCodeCurrentV1 as verifySeal } from './lightscaper-photo-native-seal-current-v1.ts';
export const LIGHTSCAPER_PHOTO_NATIVE_MANIFEST_CURRENT_V1 = 'config/lightscaper-native-photo-payload-current-v1.json';
export function lightscaperPhotoRuntimeInventoryCurrentV1(result: PhotoNativeBuildCurrentV1 | undefined) {
 return result?.files.map(file => Object.freeze({ ...file, path: `photo-native/current-v1/${result.target}/${file.path}` })) ?? [];
}
export async function verifyLightscaperPhotoRuntimeCurrentV1(runtimeRoot: string, result: PhotoNativeBuildCurrentV1): Promise<void> {
 const root = join(runtimeRoot, 'photo-native/current-v1', result.target), observed = await inventory(join(runtimeRoot, 'photo-native'));
 const expected = result.files.map(file => ({ ...file, path: `current-v1/${result.target}/${file.path}` }));
 if (JSON.stringify(observed) !== JSON.stringify(expected)) throw new Error('Packaged Photo native closure has missing, changed, extra or other-target bytes.');
 const names = paths(result.target); await verifySeal(root, result.target, [names.filesystem, names.raw, names.launcher]);
}
export async function readStagedLightscaperPhotoNativeCurrentV1(options: Readonly<{ repositoryRoot: string; appRoot: string; runtimeRoot: string; target: string; sourceRevision: string }>): Promise<PhotoNativeBuildCurrentV1 | undefined> {
 const path = join(options.appRoot, LIGHTSCAPER_PHOTO_NATIVE_MANIFEST_CURRENT_V1); let present = false;
 try { await lstat(path); present = true; } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
 if (!present) {
  try { await lstat(join(options.runtimeRoot, 'photo-native')); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
  throw new Error('Photo native bytes lack their protected application manifest.');
 }
 const bytes = await control(path); let result: PhotoNativeBuildCurrentV1;
 try { result = read(JSON.parse(bytes.toString('utf8')) as unknown); } finally { bytes.fill(0); }
 if (result.target !== options.target || result.sourceRevision !== options.sourceRevision) throw new Error('Photo native protected manifest differs from the production target/source commit.');
 const source = await sources(options.repositoryRoot, result.sourceRevision);
 try { if (source.sha256 !== result.sourceInventorySha256) throw new Error('Photo native packaged source inventory is stale.'); } finally { source.encoded.fill(0); }
 await verifyLightscaperPhotoRuntimeCurrentV1(options.runtimeRoot, result); return result;
}
