/* SPDX-License-Identifier: AGPL-3.0-only */
import { chmod, copyFile, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { copyPhotoNativePinnedFileCurrentV1 as copy, photoNativeAbsoluteCurrentV1 as absolute, photoNativeDirectoryCurrentV1 as directory,
 photoNativeInventoryCurrentV1 as inventory, readPhotoNativeControlFileCurrentV1 as control,
 photoNativeArtifactRetirementIsUnprovedCurrentV1 as artifactUnproved } from '../../desktop/lightscaper-native-photo-artifact-files-current-v1.ts';
import { photoNativePreparedRetirementIsUnprovedCurrentV1 as childUnproved } from '../../desktop/lightscaper-native-photo-prepared-child-current-v1.ts';
import { readLightscaperPhotoNativeBuildResultCurrentV1 as readResult, photoNativeTargetCurrentV1 as targetId,
 photoNativePathsCurrentV1 as pathsFor, PHOTO_NATIVE_SOURCE_INVENTORY_CURRENT_V1 as sourceInventoryPath } from '../../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
import { capturePhotoNativeSourcesCurrentV1 as sources, authenticatePhotoLibrawSourceCurrentV1 as authenticateLibraw } from './lightscaper-photo-native-source-current-v1.ts';
import { runPhotoNativeToolCurrentV1 as tool } from './lightscaper-photo-native-tool-current-v1.ts';
import { inspectPhotoNativeDependenciesCurrentV1 as dependencies, photoNativeToolchainCurrentV1 as toolchain } from './lightscaper-photo-native-dependencies-current-v1.ts';
import { sealPhotoNativeCodeCurrentV1 as seal, verifyPhotoNativeCodeCurrentV1 as verifySeal } from './lightscaper-photo-native-seal-current-v1.ts';
import { selfTestPhotoNativeCurrentV1 as selfTest, photoNativeSelfTestRetirementIsUnprovedCurrentV1 as selfTestUnproved } from './lightscaper-photo-native-selftest-current-v1.ts';
import libraw from '../../config/lightscaper-libraw-runtime-manifest.json' with { type: 'json' };
const RESULT = 'build-result.json', QUARANTINE = new Set<object>(), CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }
async function write(path: string, bytes: Uint8Array): Promise<void> {
 await mkdir(dirname(path), { recursive: true }); const file = await open(path, 'wx', 0o644); let primary: unknown, failed = false;
 try { await file.writeFile(bytes); await file.sync(); } catch (error) { failed = true; primary = error; }
 try { await file.close(); } catch (cleanup) { const error = new AggregateError([...(failed ? [primary] : []), cleanup], 'Photo build control handle retirement failed.'); QUARANTINE.add({ file, path, error }); throw error; } if (failed) throw primary;
}
export async function verifyLightscaperPhotoNativeBuildResultCurrentV1(options: Readonly<{ repositoryRoot: string; buildResultRoot: string; target: string }>) {
 const root = await directory(options.buildResultRoot), expectedTarget = targetId(options.target), encoded = await control(join(root, RESULT));
 let result: ReturnType<typeof readResult>; try { result = readResult(JSON.parse(encoded.toString('utf8')) as unknown); } finally { encoded.fill(0); }
 if (result.target !== expectedTarget) throw new Error('Photo native build result belongs to another target.');
 const observed = (await inventory(root)).filter(file => file.path !== RESULT);
 if (JSON.stringify(observed) !== JSON.stringify(result.files)) throw new Error('Photo native build result has missing, changed or extra actual bytes.');
 const source = await sources(options.repositoryRoot, result.sourceRevision);
 try {
  if (source.sha256 !== result.sourceInventorySha256) throw new Error('Photo native result differs from the actual owning source closure.');
  const fixed = pathsFor(expectedTarget), expected = [...Object.values(fixed), sourceInventoryPath, 'source/LibRaw-0.22.2.tar.gz', ...source.files.map(file => `source/${file.path}`), 'licenses/AGPL-3.0.txt', 'licenses/LibRaw-LGPL.txt', 'licenses/LibRaw-CDDL.txt', 'licenses/LibRaw-COPYRIGHT.txt', 'checks/dependencies.json', 'checks/filesystem-protocol.json', 'checks/raw-protocol.json', 'checks/raw-isolation.json'].sort();
  if (JSON.stringify(result.files.map(file => file.path).sort()) !== JSON.stringify(expected)) throw new Error('Photo native result is not the exact source/runtime/license/self-test closure.');
  // Result checksums prove internal consistency; independently owned source
  // pins prove the actual delivered corresponding source and license texts.
  const delivered = new Map(result.files.map(file => [file.path, file]));
  const requirePin = (path: string, pin: Readonly<{ sha256: string; byteLength?: number }>): void => {
   const file = delivered.get(path);
   if (!file || file.sha256 !== pin.sha256 || pin.byteLength !== undefined && file.byteLength !== pin.byteLength) throw new Error('Photo native delivered source/license differs from its owning pin.');
  };
  for (const file of source.files) requirePin(`source/${file.path}`, file);
  requirePin('source/LibRaw-0.22.2.tar.gz', libraw.upstream.sourceArchive);
  const agpl = source.files.find(file => file.path === 'LICENSE'); if (!agpl) throw new Error('Photo native owning AGPL source is absent.');
  requirePin('licenses/AGPL-3.0.txt', agpl);
  for (const [name, destination] of [['LICENSE.LGPL', 'LibRaw-LGPL.txt'], ['LICENSE.CDDL', 'LibRaw-CDDL.txt'], ['COPYRIGHT', 'LibRaw-COPYRIGHT.txt']] as const) {
   const pin = libraw.licenseFiles.find(file => file.path === `src/common/editor/raw/licenses/${name}`);
   if (!pin) throw new Error('Photo native upstream license has no owning pin.'); requirePin(`licenses/${destination}`, pin);
  }
 } finally { source.encoded.fill(0); }
 await dependencies(root, expectedTarget); const names = pathsFor(expectedTarget); await verifySeal(root, expectedTarget, [names.filesystem, names.raw, names.launcher]); return result;
}
export async function buildLightscaperPhotoNativeCurrentV1(options: Readonly<{ repositoryRoot: string; buildRoot: string; target: string;
 sourceRevision: string | null; librawSourceRoot: string; signal?: AbortSignal }>) {
 const target = targetId(options.target), repository = await directory(options.repositoryRoot), build = absolute(options.buildRoot); check(options.signal);
 await mkdir(build); const stamp = await lstat(build), work = join(build, 'work'), output = join(build, 'result-incomplete'), final = join(build, 'result');
 let primary: unknown, unretired: boolean;
 try {
  const source = await sources(repository, options.sourceRevision, options.signal);
  try {
   const upstream = await authenticateLibraw(repository, options.librawSourceRoot); check(options.signal);
   const definitions = [`-DLIGHTSCAPER_NATIVE_TARGET=${target}`, `-DLIGHTSCAPER_LIBRAW_SOURCE_ROOT=${upstream}`, '-DLIGHTSCAPER_PHOTO_BUILD_QUALIFICATION=ON', '-DCMAKE_BUILD_TYPE=Release'];
   if (target === 'mac-arm64') definitions.push('-DCMAKE_OSX_ARCHITECTURES=arm64');
   if (target.startsWith('win-')) definitions.push('-A', target === 'win-arm64' ? 'ARM64' : 'x64');
   await tool('cmake', ['-S', join(repository, 'native/lightscaper-photo-native-current-v1'), '-B', work, ...definitions], options.signal);
   await tool('cmake', ['--build', work, '--config', 'Release', '--parallel', '1', '--target', 'lightscaper_photo_granted_filesystem_current_v1', 'lightscaper_photo_raw_current_v1', 'milestone5-native-isolation-launcher', 'lightscaper_photo_isolation_canary_current_v1'], options.signal);
   check(options.signal); await mkdir(output); const paths = pathsFor(target);
   // Capture the actual compiler products, then pin/copy using bounded handles.
   for (const name of [paths.filesystem, paths.raw, paths.launcher, paths.profile, paths.broker]) {
    const from = join(work, name); await mkdir(dirname(join(output, name)), { recursive: true }); await copyFile(from, join(output, name)); if (name.startsWith('bin/')) await chmod(join(output, name), 0o755);
   }
   await seal(output, target, [paths.filesystem, paths.raw, paths.launcher], options.signal);
   await write(join(output, sourceInventoryPath), source.encoded);
   for (const file of source.files) { check(options.signal); await copy(repository, file, join(output, 'source', file.path)); }
   await copy(repository, libraw.upstream.sourceArchive, join(output, 'source/LibRaw-0.22.2.tar.gz'));
   const license = await control(join(repository, 'LICENSE')); try { await write(join(output, 'licenses/AGPL-3.0.txt'), license); } finally { license.fill(0); }
   for (const [name, destination] of [['LICENSE.LGPL', 'LibRaw-LGPL.txt'], ['LICENSE.CDDL', 'LibRaw-CDDL.txt'], ['COPYRIGHT', 'LibRaw-COPYRIGHT.txt']] as const) {
    const bytes = await control(join(upstream, name)); try { await write(join(output, 'licenses', destination), bytes); } finally { bytes.fill(0); }
   }
   const tc = await control(join(work, 'photo-native-toolchain.json')); let toolchainIdentity: ReturnType<typeof toolchain>;
   try { toolchainIdentity = toolchain(JSON.parse(tc.toString('utf8')) as unknown); } finally { tc.fill(0); }
   const facts = await dependencies(output, target); await write(join(output, 'checks/dependencies.json'), Buffer.from(`${JSON.stringify(facts)}\n`));
   const before = await inventory(output), canaryName = `bin/lightscaper_photo_isolation_canary_current_v1${target.startsWith('win-') ? '.exe' : ''}`;
   const canaryFiles = await inventory(join(work, 'bin')), canary = canaryFiles.find(file => file.path === canaryName.slice(4)); if (!canary) throw new Error('Actual private isolation canary was not built.');
   const canaryRoot = join(build, 'canary'); await mkdir(canaryRoot); const canaryPin = Object.freeze({ ...canary, path: canaryName });
   await copy(work, canaryPin, join(canaryRoot, canaryName)); await seal(canaryRoot, target, [canaryName], options.signal);
   const sealedCanary = (await inventory(canaryRoot)).find(file => file.path === canaryName); if (!sealedCanary) throw new Error('Private sealed canary is absent.');
   const selfTests = await selfTest(output, target, before, canaryRoot, sealedCanary, options.signal); check(options.signal);
   const afterSource = await sources(repository, options.sourceRevision, options.signal);
   try { if (afterSource.sha256 !== source.sha256) throw new Error('Photo native sources changed during the actual build.'); } finally { afterSource.encoded.fill(0); }
   const files = await inventory(output), result = readResult({ schemaVersion: 1, kind: 'lightscaper-photo-native-build-result-current-v1', target,
    sourceRevision: options.sourceRevision, sourceInventorySha256: source.sha256, toolchainIdentity,
    roles: { 'granted-filesystem': { protocol: 'SGR1', trust: 'trusted-readonly-broker', payloadPath: paths.filesystem }, 'raw-engine': { protocol: 'SRR1', trust: 'isolated-zero-path', payloadPath: paths.raw } },
    files, isolation: { launcherPath: paths.launcher, profilePath: paths.profile, brokerPath: paths.broker }, selfTests });
   await write(join(output, RESULT), Buffer.from(`${JSON.stringify(result)}\n`)); check(options.signal);
   await verifyLightscaperPhotoNativeBuildResultCurrentV1({ repositoryRoot: repository, buildResultRoot: output, target });
   check(options.signal); await rename(output, final); return result;
  } finally { source.encoded.fill(0); }
 } catch (error) { primary = error; unretired = artifactUnproved(error) || childUnproved(error) || selfTestUnproved(error); try { check(options.signal); } catch (reason) { primary = reason; } }
 {
  if (unretired || QUARANTINE.size) { QUARANTINE.add({ build, primary }); throw primary; }
  try { const current = await lstat(build); if (current.dev !== stamp.dev || current.ino !== stamp.ino || !current.isDirectory() || current.isSymbolicLink()) throw new Error('Owned Photo build root was replaced.'); await rm(build, { recursive: true }); }
  catch (cleanup) { QUARANTINE.add({ build, primary, cleanup }); throw new AggregateError([primary, cleanup], 'Photo native build and actual owned-root retirement failed.', { cause: cleanup }); } throw primary;
 }
}
