/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const MARKER = '.lightscaper-registered-association-owner.json';
const KIND = 'lightscaper-registered-association-ready-current-v1';
interface Identity { readonly nonce: string; readonly sourceRevision: string; readonly profilePath: string }
export interface LightscaperAssociationReadyExpectedCurrentV1 extends Identity {
	readonly archiveName: string; readonly archiveSha256: string;
}
export interface LightscaperAssociationReadyCurrentV1 extends LightscaperAssociationReadyExpectedCurrentV1 {
	readonly schemaVersion: 1; readonly kind: typeof KIND; readonly stage: 2; readonly processId: number;
}

/** The OS default handler uses its ordinary default Electron profile. Never
 * adopt an existing profile: this owner creates exactly one fresh directory. */
export async function createLightscaperAssociationProfileCurrentV1(options: Readonly<Identity & { ownerRoot: string }>) {
	const ownerRoot = absolute(options.ownerRoot), profilePath = absolute(options.profilePath);
	identity(options);
	if (profilePath === ownerRoot) throw new TypeError('Association profile must be distinct from its evidence root.');
	await directory(ownerRoot); await directory(dirname(profilePath));
	await mkdir(profilePath, { mode: 0o700 });
	const created = await directory(profilePath), markerPath = join(profilePath, MARKER);
	const marker = `${JSON.stringify({ schemaVersion: 1, kind: 'lightscaper-registered-association-profile-current-v1',
		ownerRoot, profilePath, nonce: options.nonce, sourceRevision: options.sourceRevision,
		profileDevice: String(created.dev), profileInode: String(created.ino) })}\n`;
	// A failed marker write leaves the newly owned directory available for
	// diagnosis; it never grants authority over a preexisting directory.
	await writeFile(markerPath, marker, { flag: 'wx', mode: 0o600 });
	let closed = false;
	return Object.freeze({ profilePath, markerPath, async close(readersRetired: boolean): Promise<void> {
		if (closed) return;
		if (readersRetired !== true) throw new Error('Association profile readers have not actually retired.');
		const current = await directory(profilePath);
		if (current.dev !== created.dev || current.ino !== created.ino || await regularText(markerPath) !== marker) throw new Error('Association profile ownership changed; retaining its directory.');
		await rm(profilePath, { recursive: true }); closed = true;
	} });
}

export function readLightscaperAssociationReadyCurrentV1(value: unknown,
	expected: Readonly<LightscaperAssociationReadyExpectedCurrentV1>): LightscaperAssociationReadyCurrentV1 {
	identity(expected);
	if (typeof expected.archiveName !== 'string' || !expected.archiveName.endsWith('.liscape') || expected.archiveName.length > 256
		|| /[\\/\0\r\n]/u.test(expected.archiveName) || !/^[a-f0-9]{64}$/u.test(expected.archiveSha256)) throw new TypeError('Invalid association archive identity.');
	const row = record(value, ['schemaVersion', 'kind', 'nonce', 'sourceRevision', 'profilePath', 'archiveName', 'archiveSha256', 'stage', 'processId']);
	if (row.schemaVersion !== 1 || row.kind !== KIND || row.stage !== 2 || typeof row.processId !== 'number'
		|| !Number.isSafeInteger(row.processId) || row.processId < 1 || row.processId > 0xffffffff
		|| row.nonce !== expected.nonce || row.sourceRevision !== expected.sourceRevision || row.profilePath !== expected.profilePath
		|| row.archiveName !== expected.archiveName || row.archiveSha256 !== expected.archiveSha256) throw new TypeError('Association readiness differs from its actual private stage.');
	return Object.freeze({ schemaVersion: 1, kind: KIND, ...expected, stage: 2, processId: row.processId });
}

/** Ready bytes are written atomically by the existing private Main hook. The
 * file is not a process-completion witness and cannot substitute for its join. */
export async function waitLightscaperAssociationReadyCurrentV1(filePath: string,
	expected: Readonly<LightscaperAssociationReadyExpectedCurrentV1>, running: Promise<unknown>,
	options: Readonly<{ deadlineMs: number }>): Promise<LightscaperAssociationReadyCurrentV1> {
	absolute(filePath);
	if (!Number.isSafeInteger(options.deadlineMs) || options.deadlineMs < 1 || options.deadlineMs > 60_000) throw new RangeError('Association readiness exceeds its bounded startup allowance.');
	let ended = false, failure: unknown;
	void running.then(() => { ended = true; }, error => { failure = error; ended = true; });
	const until = Date.now() + options.deadlineMs;
	for (;;) {
		if (ended) throw new Error('Actual primary closed before its readiness could be observed.', { cause: failure });
		try { return readLightscaperAssociationReadyCurrentV1(JSON.parse(await regularText(filePath)) as unknown, expected); }
		catch (error) { if (!missing(error)) throw error; }
		if (Date.now() >= until) throw new Error('Actual primary did not publish bounded private readiness.');
		await delay(Math.min(25, Math.max(1, until - Date.now())));
	}
}
function identity(value: Identity): void {
	absolute(value.profilePath);
	if (!/^[a-f0-9]{32}$/u.test(value.nonce) || !/^[a-f0-9]{40}$/u.test(value.sourceRevision)) throw new TypeError('Association identity requires its exact nonce and source.');
}
function absolute(value: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value.includes('\0')) throw new TypeError('Association path must be canonical and absolute.');
	return value;
}
async function directory(path: string) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path
		|| process.getuid && metadata.uid !== process.getuid()) throw new Error('Association owner requires a canonical current-user directory.');
	return metadata;
}
async function regularText(path: string): Promise<string> {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > 4096 || await realpath(path) !== path
		|| process.getuid && (before.uid !== process.getuid() || (before.mode & 0o077) !== 0)) throw new Error('Association evidence must be one bounded private regular file.');
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = await handle.stat();
		if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error('Association evidence changed while opening.');
		const text = await readFile(handle, 'utf8'), after = await handle.stat(), atPath = await lstat(path);
		if (Buffer.byteLength(text) !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
			|| after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || atPath.dev !== before.dev || atPath.ino !== before.ino || atPath.isSymbolicLink()) throw new Error('Association evidence changed while reading.');
		return text;
	} finally { await handle.close(); }
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
		|| Reflect.ownKeys(value).length !== keys.length) throw new TypeError('Association readiness requires a closed record.');
	const row: Record<string, unknown> = {};
	for (const key of keys) {
		const field = Object.getOwnPropertyDescriptor(value, key);
		if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw new TypeError('Association readiness requires own data fields.');
		row[key] = field.value;
	}
	return row;
}
function missing(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'; }
