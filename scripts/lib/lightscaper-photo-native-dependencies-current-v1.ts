/* SPDX-License-Identifier: AGPL-3.0-only */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { photoNativeRecordCurrentV1 as record, photoNativePathsCurrentV1 as paths, type PhotoNativeBuildCurrentV1, type PhotoNativeTargetCurrentV1 } from '../../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
// Reuse the maintained actual PE/Mach-O/ELF parser and recursive-inspection
// entry, without casting its JS module into a product/backend capability.
const owner: unknown = createRequire(import.meta.url)('./soundscaper-professional-native-dependency-inspection.mjs');
const inspect = (() => { const candidate: unknown = Reflect.get(owner as object, 'inspectSoundscaperProfessionalNativeDependencies');
 if (typeof candidate !== 'function') throw new TypeError('The maintained native dependency inspector is missing.'); return candidate; })();
const WINDOWS = new Set(['advapi32.dll', 'kernel32.dll', 'kernelbase.dll', 'ntdll.dll', 'userenv.dll', 'user32.dll', 'onecoreuap.dll', 'bcrypt.dll', 'ucrtbase.dll', 'msvcrt.dll', 'rpcrt4.dll', 'sechost.dll', 'ole32.dll', 'oleaut32.dll', 'ws2_32.dll']);
const LINUX = new Set(['libc.so.6', 'libm.so.6', 'libstdc++.so.6', 'libgcc_s.so.1', 'libpthread.so.0', 'libdl.so.2', 'librt.so.1']);
const LINUX_LOADERS = Object.freeze({ 'linux-x64': 'ld-linux-x86-64.so.2', 'linux-arm64': 'ld-linux-aarch64.so.1' });
const MACOS = new Set(['/usr/lib/libc++.1.dylib', '/usr/lib/libSystem.B.dylib', '/usr/lib/libsandbox.1.dylib', '/usr/lib/libproc.dylib']);
export async function inspectPhotoNativeDependenciesCurrentV1(root: string, target: PhotoNativeTargetCurrentV1) {
 const names = paths(target), results: Readonly<{ path: string; architecture: unknown; imports: readonly string[]; rpaths: readonly string[] }>[] = [];
 for (const artifact of [names.filesystem, names.raw, names.launcher]) {
  const value: unknown = await Reflect.apply(inspect, owner, [{ target, path: join(root, artifact) }]);
  const row = record(value, ['architecture', 'imports', 'rpaths']);
  if (!Array.isArray(row.imports) || row.imports.length > 256 || row.imports.some(value => typeof value !== 'string' || value.length < 1 || value.length > 512)
   || !Array.isArray(row.rpaths) || row.rpaths.length !== 0) throw new Error('Photo native dependency closure is unbounded or has an ambient RPATH.');
  const imports: string[] = row.imports;
  for (const name of imports) {
   if (target === 'linux-x64' || target === 'linux-arm64') { if (!LINUX.has(name) && name !== LINUX_LOADERS[target]) throw new Error(`Photo Linux artifact ${artifact} for ${target} imports an undeclared OS substrate library: ${name}`); continue; }
   if (target === 'mac-arm64' ? !MACOS.has(name) : !WINDOWS.has(name.toLowerCase()) && !/^api-ms-win-[a-z0-9-]+\.dll$/u.test(name.toLowerCase())) throw new Error(`Photo native artifact ${artifact} for ${target} has an undeclared ambient dependency: ${name}`);
  }
  const architecture = record(row.architecture, ['schemaVersion', 'target', 'format', 'architecture', 'machine']);
  if (architecture.schemaVersion !== 1 || architecture.target !== target) throw new Error('Photo native dependency inspector returned another target.');
  results.push(Object.freeze({ path: artifact, architecture: row.architecture, imports: Object.freeze([...imports].sort()), rpaths: Object.freeze([]) }));
 }
 return Object.freeze(results);
}
export function photoNativeToolchainCurrentV1(value: unknown): PhotoNativeBuildCurrentV1['toolchainIdentity'] {
 const row = record(value, ['cmakeVersion', 'generator', 'compiler', 'compilerVersion', 'platform', 'architecture']);
 for (const field of Object.values(row)) if (typeof field !== 'string' || !field || field.length > 256) throw new TypeError('Photo native actual toolchain identity is malformed.');
 return Object.freeze({ cmakeVersion: row.cmakeVersion as string, generator: row.generator as string, compiler: row.compiler as string,
  compilerVersion: row.compilerVersion as string, platform: row.platform as string, architecture: row.architecture as string });
}
