/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { copyPhotoNativePinnedFileCurrentV1 as copy, readPhotoNativeControlFileCurrentV1 as control, photoNativeDirectoryCurrentV1 as directory, photoNativeInventoryCurrentV1 as inventory,
 photoNativeArtifactRetirementIsUnprovedCurrentV1 as unproved } from '../../desktop/lightscaper-native-photo-artifact-files-current-v1.ts';
import { verifyLightscaperPhotoNativeBuildResultCurrentV1 as verifyBuild } from './lightscaper-photo-native-build-current-v1.ts';
import { verifyDesktopLightscaperRawRuntimeCurrentV1 as verifyWasm } from './desktop-lightscaper-raw-runtime-current-v1.ts';
const MANIFEST = 'config/lightscaper-native-photo-payload-current-v1.json', QUARANTINE = new Set<object>();
type Options = Readonly<{ repositoryRoot: string; buildResultRoot: string; runtimeRoot: string; applicationRoot: string; target: string; signal?: AbortSignal; allowWorkingTree?: boolean }>;
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }
async function absent(path: string): Promise<boolean> { try { await lstat(path); return false; } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return true; throw error; } }
function same(a: unknown, b: unknown): void { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Photo native actual closure differs from its protected result.'); }
export async function stageLightscaperPhotoNativeCurrentV1(options: Options) {
 check(options.signal); const result = await verifyBuild(options);
 if (result.sourceRevision === null && options.allowWorkingTree !== true) throw new Error('Production Photo staging requires a real source revision.');
 const runtime = await directory(options.runtimeRoot), app = await directory(options.applicationRoot), wasm = await verifyWasm({ runtimeRoot: runtime });
 const manifest = join(app, MANIFEST), prefix = join(runtime, 'photo-native');
 if (!await absent(manifest) || !await absent(prefix)) throw new Error('Photo native protected manifest/destination is occupied.');
 check(options.signal); await mkdir(prefix); const stamp = await lstat(prefix); let createdManifest = false, manifestStamp: Awaited<ReturnType<typeof lstat>> | undefined;
 const directories = new Map<string, Awaited<ReturnType<typeof lstat>>>([[prefix, stamp]]), ownedFiles = new Map<string, Awaited<ReturnType<typeof lstat>>>();
 let unretired = false, copying = false, primary: unknown;
 async function parents(path: string): Promise<void> {
  let parent = prefix;
  for (const part of relative(prefix, path).split(sep).filter(Boolean)) { parent = join(parent, part); if (directories.has(parent)) continue; await mkdir(parent); directories.set(parent, await lstat(parent)); }
 }
 async function proveOwned(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
   const full = join(path, entry.name), now = await lstat(full), owned = directories.get(full) ?? ownedFiles.get(full);
   if (!owned || now.dev !== owned.dev || now.ino !== owned.ino || now.isSymbolicLink() || now.isDirectory() !== directories.has(full)) throw new Error('Foreign or replaced content protects a partial Photo stage.');
   if (directories.has(full)) await proveOwned(full);
  }
 }
 try {
  const target = join(prefix, 'current-v1', result.target); await parents(target);
  for (const file of result.files) { check(options.signal); const path = join(target, file.path); await parents(dirname(path)); copying = true; const owned = await copy(options.buildResultRoot, file, path); copying = false; ownedFiles.set(path, owned); }
  same(await inventory(target), result.files); same(await verifyWasm({ runtimeRoot: runtime }), wasm); check(options.signal);
  await mkdir(dirname(manifest), { recursive: true });
  const file = await open(manifest, 'wx', 0o644); createdManifest = true;
  try { manifestStamp = await file.stat(); await file.writeFile(`${JSON.stringify(result)}\n`); await file.sync(); } catch (primary) {
   try { await file.close(); } catch (cleanup) { const error = new AggregateError([primary, cleanup], 'Photo native manifest and close failed.'); unretired = true; QUARANTINE.add({ file, result, error }); throw error; } throw primary;
  }
  try { await file.close(); } catch (error) { unretired = true; QUARANTINE.add({ file, result, error }); throw error; }
  return Object.freeze({ schemaVersion: 1 as const, kind: 'lightscaper-photo-native-stage-current-v1' as const, target: result.target, sourceRevision: result.sourceRevision,
   sourceInventorySha256: result.sourceInventorySha256, files: result.files });
 } catch (error) { primary = error; }
 {
  if (unretired || copying || unproved(primary)) { QUARANTINE.add({ prefix, result, primary }); throw primary; }
  const errors: unknown[] = [];
  if (createdManifest && manifestStamp) try { const now = await lstat(manifest); if (now.dev !== manifestStamp.dev || now.ino !== manifestStamp.ino || !now.isFile() || now.isSymbolicLink()) throw new Error('Photo native owned manifest was replaced during failed staging.'); await rm(manifest); } catch (error) { errors.push(error); }
  try { const now = await lstat(prefix); if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== stamp.dev || now.ino !== stamp.ino) throw new Error('Photo native owned stage root was replaced.'); await proveOwned(prefix); await rm(prefix, { recursive: true }); } catch (error) { errors.push(error); }
  if (errors.length) { QUARANTINE.add({ prefix, result, primary, errors }); throw new AggregateError([primary, ...errors], 'Photo native staging and owned partial retirement failed.'); } throw primary;
 }
}
export async function verifyLightscaperPhotoNativeStageCurrentV1(options: Options) {
 const result = await verifyBuild(options), runtime = await directory(options.runtimeRoot), app = await directory(options.applicationRoot);
 const bytes = await control(join(app, MANIFEST)); let actual: unknown;
 try { actual = JSON.parse(bytes.toString('utf8')) as unknown; } finally { bytes.fill(0); }
 same(actual, result); same(await inventory(join(runtime, 'photo-native/current-v1', result.target)), result.files);
 await verifyWasm({ runtimeRoot: runtime });
 return Object.freeze({ schemaVersion: 1 as const, kind: 'lightscaper-photo-native-stage-current-v1' as const, target: result.target, sourceRevision: result.sourceRevision,
  sourceInventorySha256: result.sourceInventorySha256, files: result.files });
}
