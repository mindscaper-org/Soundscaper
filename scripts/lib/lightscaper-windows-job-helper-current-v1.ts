/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { inspectSoundscaperNativeBinaryFile } from './soundscaper-native-binary-architecture.mjs';

export type LightscaperWindowsJobTargetCurrentV1 = 'win-x64' | 'win-arm64';
export interface LightscaperWindowsJobHelperIdentityCurrentV1 {
	readonly path: string; readonly sha256: string; readonly byteLength: number;
	readonly target: LightscaperWindowsJobTargetCurrentV1;
}
declare const admittedAuthority: unique symbol;
export interface LightscaperWindowsJobAdmissionCurrentV1 {
	readonly executable: string; readonly helper: LightscaperWindowsJobHelperIdentityCurrentV1;
	readonly [admittedAuthority]: true;
}
const admissions = new WeakSet<object>();
const MAXIMUM_HELPER_BYTES = 64 * 1024 * 1024;

/** Selection follows the Node process actually executing this driver. Each
 * Windows architecture is independently admitted and qualified on its host. */
export function lightscaperWindowsJobTargetCurrentV1(platform: string, architecture: string): LightscaperWindowsJobTargetCurrentV1 {
	if (platform !== 'win32' || (architecture !== 'x64' && architecture !== 'arm64')) throw new Error('Windows Job verification requires a native Windows x64 or ARM64 Node host.');
	return architecture === 'x64' ? 'win-x64' : 'win-arm64';
}

/** Byte/PE inspection is usable by focused file tests on other hosts. This
 * receipt alone grants no authority to launch a Windows process. */
export async function inspectLightscaperWindowsJobHelperCurrentV1(options: Readonly<{
	path: string; sha256: string; target: LightscaperWindowsJobTargetCurrentV1;
}>): Promise<LightscaperWindowsJobHelperIdentityCurrentV1> {
	if (!/^[a-f0-9]{64}$/u.test(options.sha256) || !['win-x64', 'win-arm64'].includes(options.target)) throw new TypeError('Windows Job helper digest/target must be explicit.');
	const path = await canonicalRegularFile(options.path);
	await inspectSoundscaperNativeBinaryFile({ path, target: options.target, maximumBytes: MAXIMUM_HELPER_BYTES });
	const before = await lstat(path), handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size < 12 || opened.size > MAXIMUM_HELPER_BYTES || !sameFile(before, opened)) throw new Error('Windows Job helper changed while opening.');
		const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
		let offset = 0;
		while (offset < opened.size) {
			const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - offset), offset);
			if (bytesRead === 0) throw new Error('Windows Job helper ended before its authenticated length.');
			hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
		}
		const after = await handle.stat(), atPath = await lstat(path);
		if (!sameFile(opened, after) || !sameFile(after, atPath) || atPath.isSymbolicLink()
			|| await realpath(path) !== path) throw new Error('Windows Job helper changed while hashing.');
		const sha256 = hash.digest('hex');
		if (sha256 !== options.sha256) throw new Error('Windows Job helper SHA-256 differs from its explicit pin.');
		return Object.freeze({ path, sha256, byteLength: opened.size, target: options.target });
	} finally { await handle.close(); }
}

/** Call before creating any verification profile. No missing helper fallback. */
export async function admitLightscaperWindowsJobHelperCurrentV1(options: Readonly<{
	helperPath: string; helperSha256: string; executable: string;
}>): Promise<LightscaperWindowsJobAdmissionCurrentV1> {
	const target = lightscaperWindowsJobTargetCurrentV1(process.platform, process.arch);
	const helper = await inspectLightscaperWindowsJobHelperCurrentV1({ path: options.helperPath, sha256: options.helperSha256, target });
	const executable = await canonicalRegularFile(options.executable);
	await inspectSoundscaperNativeBinaryFile({ path: executable, target });
	const admission = Object.freeze({ executable, helper }) as LightscaperWindowsJobAdmissionCurrentV1;
	admissions.add(admission);
	return admission;
}

export async function revalidateLightscaperWindowsJobAdmissionCurrentV1(value: LightscaperWindowsJobAdmissionCurrentV1): Promise<void> {
	if (!value || !admissions.has(value)) throw new TypeError('Unissued Windows Job helper admission.');
	const target = lightscaperWindowsJobTargetCurrentV1(process.platform, process.arch);
	if (value.helper.target !== target) throw new Error('Windows Job helper target differs from its current host.');
	await inspectLightscaperWindowsJobHelperCurrentV1({ path: value.helper.path, sha256: value.helper.sha256, target });
	await inspectSoundscaperNativeBinaryFile({ path: value.executable, target });
}
async function canonicalRegularFile(value: string): Promise<string> {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0') || resolve(value) !== value) throw new TypeError('Windows Job binary path must be explicit, absolute and normalized.');
	const before = await lstat(value);
	if (!before.isFile() || before.isSymbolicLink()) throw new TypeError('Windows Job binary must be a regular non-symlink file.');
	const path = await realpath(value), after = await lstat(path);
	if (!sameFile(before, after)) throw new Error('Windows Job binary changed while resolving.');
	return path;
}
function sameFile(a: Readonly<{ size: number; mtimeMs: number; ctimeMs: number; ino: number; dev: number }>,
	b: Readonly<{ size: number; mtimeMs: number; ctimeMs: number; ino: number; dev: number }>): boolean {
	return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
		&& (a.ino === 0 || b.ino === 0 || (a.ino === b.ino && a.dev === b.dev));
}
