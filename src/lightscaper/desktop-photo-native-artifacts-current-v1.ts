/* SPDX-License-Identifier: AGPL-3.0-only */
export const PHOTO_NATIVE_TARGETS_CURRENT_V1 = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'] as const);
export type PhotoNativeTargetCurrentV1 = typeof PHOTO_NATIVE_TARGETS_CURRENT_V1[number];
export type PhotoNativeRoleCurrentV1 = 'granted-filesystem' | 'raw-engine';
export type PhotoNativeFileCurrentV1 = Readonly<{ path: string; byteLength: number; sha256: string }>;
export type PhotoNativeBuildCurrentV1 = Readonly<{
 schemaVersion: 1; kind: 'lightscaper-photo-native-build-result-current-v1'; target: PhotoNativeTargetCurrentV1;
 sourceRevision: string | null; sourceInventorySha256: string;
 toolchainIdentity: Readonly<{ cmakeVersion: string; generator: string; compiler: string; compilerVersion: string; platform: string; architecture: string }>;
 roles: Readonly<{ 'granted-filesystem': Readonly<{ protocol: 'SGR1'; trust: 'trusted-readonly-broker'; payloadPath: string }>;
  'raw-engine': Readonly<{ protocol: 'SRR1'; trust: 'isolated-zero-path'; payloadPath: string }> }>;
 files: readonly PhotoNativeFileCurrentV1[];
 isolation: Readonly<{ launcherPath: string; profilePath: string; brokerPath: string }>;
 selfTests: readonly Readonly<{ id: string; status: 'passed'; sha256: string }>[];
}>;
export const PHOTO_NATIVE_SOURCE_INVENTORY_CURRENT_V1 = 'source/source-inventory.json';
export const PHOTO_NATIVE_MAXIMUM_CLOSURE_CURRENT_V1 = 256 * 1024 * 1024;
export function photoNativeRecordCurrentV1(value: unknown, keys: readonly string[]): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Photo native profile requires an own closed record.');
 const descriptors = Object.getOwnPropertyDescriptors(value), observed = Reflect.ownKeys(descriptors);
 if (observed.length !== keys.length || observed.some(key => typeof key !== 'string' || !keys.includes(key))) throw new TypeError('Photo native profile has unknown or missing fields.');
 const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
 for (const key of keys) { const descriptor = descriptors[key]; if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Photo native profile refuses accessors.'); result[key] = descriptor.value; }
 return result;
}
export function photoNativeTargetCurrentV1(value: unknown): PhotoNativeTargetCurrentV1 {
 for (const target of PHOTO_NATIVE_TARGETS_CURRENT_V1) if (value === target) return target;
 throw new TypeError('Photo native target is unsupported.');
}
export function photoNativeRelativeCurrentV1(value: unknown): string {
 if (typeof value !== 'string' || value.length < 1 || value.length > 512 || !/^[A-Za-z0-9._~/-]+$/u.test(value)
  || value.split('/').some(part => !part || part === '.' || part === '..')) throw new TypeError('Photo native path must stay in its fixed relative closure.');
 return value;
}
export function photoNativeDigestCurrentV1(value: unknown): string {
 if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Photo native digest is invalid.'); return value;
}
function vector(value: unknown, maximum: number): readonly unknown[] {
 if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('Photo native inventory must be a bounded dense vector.');
 const captured: unknown[] = [];
 for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Photo native inventory refuses holes/accessors.'); captured.push(descriptor.value); }
 return captured;
}
export function photoNativePathsCurrentV1(target: PhotoNativeTargetCurrentV1) {
 const extension = target.startsWith('win-') ? '.exe' : '', platform = target.startsWith('linux-') ? 'linux' : target.startsWith('win-') ? 'windows' : 'macos';
 return Object.freeze({ filesystem: `bin/lightscaper_photo_granted_filesystem_current_v1${extension}`, raw: `bin/lightscaper_photo_raw_current_v1${extension}`,
  launcher: `bin/milestone5-native-isolation-launcher${extension}`, profile: `profiles/${platform}-v1.${platform === 'macos' ? 'sb' : 'json'}`, broker: `profiles/${platform}-broker-v1.json` });
}
export function readLightscaperPhotoNativeBuildResultCurrentV1(value: unknown): PhotoNativeBuildCurrentV1 {
 const row = photoNativeRecordCurrentV1(value, ['schemaVersion', 'kind', 'target', 'sourceRevision', 'sourceInventorySha256', 'toolchainIdentity', 'roles', 'files', 'isolation', 'selfTests']);
 if (row.schemaVersion !== 1 || row.kind !== 'lightscaper-photo-native-build-result-current-v1'
  || (row.sourceRevision !== null && (typeof row.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/u.test(row.sourceRevision)))) throw new TypeError('Photo native result identity is invalid.');
 const target = photoNativeTargetCurrentV1(row.target), paths = photoNativePathsCurrentV1(target), sourceInventorySha256 = photoNativeDigestCurrentV1(row.sourceInventorySha256);
 const tool = photoNativeRecordCurrentV1(row.toolchainIdentity, ['cmakeVersion', 'generator', 'compiler', 'compilerVersion', 'platform', 'architecture']);
 for (const value of Object.values(tool)) if (typeof value !== 'string' || !value.length || value.length > 256 || Array.from(value).some(character => character.charCodeAt(0) < 32)) throw new TypeError('Photo native toolchain identity is invalid.');
 const roles = photoNativeRecordCurrentV1(row.roles, ['granted-filesystem', 'raw-engine']);
 const fs = photoNativeRecordCurrentV1(roles['granted-filesystem'], ['protocol', 'trust', 'payloadPath']), raw = photoNativeRecordCurrentV1(roles['raw-engine'], ['protocol', 'trust', 'payloadPath']);
 if (fs.protocol !== 'SGR1' || fs.trust !== 'trusted-readonly-broker' || fs.payloadPath !== paths.filesystem
  || raw.protocol !== 'SRR1' || raw.trust !== 'isolated-zero-path' || raw.payloadPath !== paths.raw) throw new TypeError('Photo native fixed role identity differs.');
 const files = vector(row.files, 256).map(value => {
  const file = photoNativeRecordCurrentV1(value, ['path', 'byteLength', 'sha256']);
  if (typeof file.byteLength !== 'number' || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > 64 * 1024 * 1024) throw new RangeError('Photo native file length exceeds its bound.');
  return Object.freeze({ path: photoNativeRelativeCurrentV1(file.path), byteLength: file.byteLength, sha256: photoNativeDigestCurrentV1(file.sha256) });
 });
 const fixed = new Set([...Object.values(paths), PHOTO_NATIVE_SOURCE_INVENTORY_CURRENT_V1, 'licenses/AGPL-3.0.txt', 'licenses/LibRaw-LGPL.txt', 'licenses/LibRaw-CDDL.txt', 'licenses/LibRaw-COPYRIGHT.txt', 'source/LibRaw-0.22.2.tar.gz', 'checks/dependencies.json', 'checks/filesystem-protocol.json', 'checks/raw-protocol.json', 'checks/raw-isolation.json']);
 for (const file of files) if (!fixed.has(file.path) && (!file.path.startsWith('source/') || file.path.startsWith('source/bin/'))) throw new TypeError('Photo native result contains an undeclared executable/profile/check/license path.');
 if (new Set(files.map(file => file.path)).size !== files.length || files.reduce((sum, file) => sum + file.byteLength, 0) > PHOTO_NATIVE_MAXIMUM_CLOSURE_CURRENT_V1) throw new RangeError('Photo native closure is duplicate or too large.');
 const isolation = photoNativeRecordCurrentV1(row.isolation, ['launcherPath', 'profilePath', 'brokerPath']);
 if (isolation.launcherPath !== paths.launcher || isolation.profilePath !== paths.profile || isolation.brokerPath !== paths.broker) throw new TypeError('Photo native target isolation closure differs.');
 for (const path of [...Object.values(paths), PHOTO_NATIVE_SOURCE_INVENTORY_CURRENT_V1, 'licenses/AGPL-3.0.txt', 'licenses/LibRaw-LGPL.txt', 'licenses/LibRaw-CDDL.txt', 'licenses/LibRaw-COPYRIGHT.txt', 'source/LibRaw-0.22.2.tar.gz', 'checks/dependencies.json']) if (!files.some(file => file.path === path)) throw new TypeError('Photo native result lacks its fixed runtime/source closure.');
 if (files.find(file => file.path === PHOTO_NATIVE_SOURCE_INVENTORY_CURRENT_V1)!.sha256 !== sourceInventorySha256) throw new TypeError('Photo native source inventory is unbound.');
 const selfTests = vector(row.selfTests, 3).map(value => { const test = photoNativeRecordCurrentV1(value, ['id', 'status', 'sha256']);
  if (typeof test.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(test.id) || test.status !== 'passed') throw new TypeError('Photo native self-test receipt is invalid.');
  return Object.freeze({ id: test.id, status: 'passed' as const, sha256: photoNativeDigestCurrentV1(test.sha256) }); });
 if (new Set(selfTests.map(test => test.id)).size !== selfTests.length || ['filesystem-protocol', 'raw-protocol', 'raw-isolation'].some(id => !selfTests.some(test => test.id === id))) throw new TypeError('Photo native result lacks actual mandatory self-tests.');
 for (const check of selfTests) if (!files.some(file => file.path === `checks/${check.id}.json` && file.sha256 === check.sha256)) throw new Error('Photo native self-test is not bound to its actual checked output.');
 return Object.freeze({ schemaVersion: 1, kind: 'lightscaper-photo-native-build-result-current-v1', target, sourceRevision: row.sourceRevision as string | null, sourceInventorySha256,
  toolchainIdentity: Object.freeze({ cmakeVersion: tool.cmakeVersion as string, generator: tool.generator as string, compiler: tool.compiler as string, compilerVersion: tool.compilerVersion as string, platform: tool.platform as string, architecture: tool.architecture as string }),
  roles: Object.freeze({ 'granted-filesystem': Object.freeze({ protocol: 'SGR1', trust: 'trusted-readonly-broker', payloadPath: paths.filesystem }), 'raw-engine': Object.freeze({ protocol: 'SRR1', trust: 'isolated-zero-path', payloadPath: paths.raw }) }),
  files: Object.freeze(files), isolation: Object.freeze({ launcherPath: paths.launcher, profilePath: paths.profile, brokerPath: paths.broker }), selfTests: Object.freeze(selfTests) });
}
