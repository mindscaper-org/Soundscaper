/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { launchLightscaperManagedSmokeProcessCurrentV1, type LightscaperManagedProcessReceiptCurrentV1 } from './lightscaper-desktop-managed-smoke-process-current-v1.ts';
import { admitLightscaperWindowsJobHelperCurrentV1, launchLightscaperWindowsJobProcessCurrentV1 } from './lightscaper-windows-job-driver-current-v1.ts';

export function associationRecordCurrentV1(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
		|| Reflect.ownKeys(value).length !== keys.length) throw new TypeError('Association evidence requires an exact closed record.');
	const row: Record<string, unknown> = {};
	for (const key of keys) {
		const field = Object.getOwnPropertyDescriptor(value, key);
		if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw new TypeError('Association evidence requires own data fields.');
		row[key] = field.value;
	}
	return row;
}
export function associationAbsoluteCurrentV1(value: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value.includes('\0')) throw new TypeError('Association path must be an absolute canonical spelling.');
	return value;
}
export function associationShaCurrentV1(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export async function associationFileCurrentV1(path: string, maximum: number) {
	associationAbsoluteCurrentV1(path);
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum || await realpath(path) !== path) throw new Error('Association input must be one bounded canonical regular file.');
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = await handle.stat();
		if (!same(before, opened)) throw new Error('Association input changed while opening.');
		const hash = createHash('sha256'); let byteLength = 0;
		for await (const chunk of handle.createReadStream({ autoClose: false })) {
			const bytes: unknown = chunk;
			if (!(bytes instanceof Uint8Array)) throw new Error('Association file stream did not return bytes.');
			byteLength += bytes.byteLength; if (byteLength > maximum) throw new Error('Association file grew beyond its bound.'); hash.update(bytes);
		}
		const after = await handle.stat(), atPath = await lstat(path);
		if (byteLength !== before.size || !same(opened, after) || !same(after, atPath) || atPath.isSymbolicLink()) throw new Error('Association input changed during readback.');
		return Object.freeze({ path, byteLength, sha256: hash.digest('hex') });
	} finally { await handle.close(); }
}
export async function associationReadCurrentV1(path: string, maximum: number): Promise<Buffer> {
	const pin = await associationFileCurrentV1(path, maximum), handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const bytes = await handle.readFile();
		if (bytes.byteLength !== pin.byteLength || associationShaCurrentV1(bytes) !== pin.sha256) throw new Error('Association evidence changed after its exact readback.');
		return bytes;
	} finally { await handle.close(); }
}
export async function associationToolCurrentV1(name: string): Promise<string> {
	if (!/^[a-zA-Z0-9.-]+$/u.test(name)) throw new TypeError('Association tool name must be a fixed basename.');
	for (const parent of (process.env.PATH ?? '').split(delimiter)) {
		if (!parent || !isAbsolute(parent)) continue;
		const candidate = join(parent, name);
		try {
			const path = await realpath(candidate), stat = await lstat(path);
			if (stat.isFile() && !stat.isSymbolicLink() && (process.platform === 'win32' || (stat.mode & 0o111) !== 0 && (stat.mode & 0o022) === 0)) return path;
		} catch (error) { if (!associationMissingCurrentV1(error)) throw error; }
	}
	throw new Error(`Actual association prerequisite is unavailable: ${name}`);
}
export interface LightscaperAssociationProcessOwnerCurrentV1 {
	run(executable: string, args: readonly string[], options?: Readonly<{ deadlineMs?: number; acceptedExitCodes?: readonly number[] }>): Promise<LightscaperManagedProcessReceiptCurrentV1>;
	readonly readersRetired: boolean;
}
/** Every utility/native helper still uses the existing actual process-group or
 * native Job supervisor. A helper result alone never grants cleanup authority. */
export function createLightscaperAssociationProcessOwnerCurrentV1(options: Readonly<{
	evidenceRoot: string; windowsJobHelper?: string; windowsJobHelperSha256?: string;
}>): LightscaperAssociationProcessOwnerCurrentV1 {
	let readersRetired = true, at = 0;
	return Object.freeze({ get readersRetired() { return readersRetired; }, async run(executable: string, args: readonly string[], limits: Readonly<{ deadlineMs?: number; acceptedExitCodes?: readonly number[] }> = {}) {
		if (!readersRetired) throw new Error('An earlier association consumer has not actually retired.');
		const nonce = randomBytes(16).toString('hex'), name = `association-process-${++at}`;
		const windows = process.platform === 'win32' ? await admitLightscaperWindowsJobHelperCurrentV1({
			helperPath: options.windowsJobHelper ?? '', helperSha256: options.windowsJobHelperSha256 ?? '', executable,
		}) : null;
		readersRetired = false;
		const receipt = windows ? await launchLightscaperWindowsJobProcessCurrentV1(windows, args, {
			nonce, stage: 1, receiptPath: join(options.evidenceRoot, `${nonce}.stage-1.windows-job.json`), deadlineMs: limits.deadlineMs,
		}) : await launchLightscaperManagedSmokeProcessCurrentV1(executable, args, { deadlineMs: limits.deadlineMs });
		readersRetired = receipt.readersRetired;
		await writeFile(join(options.evidenceRoot, `${name}.json`), `${JSON.stringify({ executable, args, process: receipt }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
		if (!readersRetired || receipt.expired || receipt.forcedGroupRetirement || receipt.launchError || receipt.signal !== null
			|| receipt.exitCode === null || !(limits.acceptedExitCodes ?? [0]).includes(receipt.exitCode)) throw new Error(`Actual association command failed or did not naturally retire: ${name}`);
		return receipt;
	} });
}
export function associationMissingCurrentV1(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'; }
function same(a: Readonly<{ dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>, b: Readonly<{ dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>): boolean {
	return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
