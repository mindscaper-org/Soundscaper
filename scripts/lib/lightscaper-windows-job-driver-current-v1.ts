/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { assertLightscaperWindowsJobIdentityCurrentV1, LIGHTSCAPER_WINDOWS_JOB_RECEIPT_MAXIMUM_BYTES_CURRENT_V1,
	lightscaperWindowsJobProcessReceiptCurrentV1, readLightscaperWindowsJobReceiptCurrentV1 } from './lightscaper-windows-job-contract-current-v1.ts';
import type { LightscaperWindowsJobReceiptCurrentV1, LightscaperWindowsManagedProcessReceiptCurrentV1 } from './lightscaper-windows-job-contract-current-v1.ts';
import { revalidateLightscaperWindowsJobAdmissionCurrentV1 } from './lightscaper-windows-job-helper-current-v1.ts';
import type { LightscaperWindowsJobAdmissionCurrentV1 } from './lightscaper-windows-job-helper-current-v1.ts';
export { admitLightscaperWindowsJobHelperCurrentV1 } from './lightscaper-windows-job-helper-current-v1.ts';

const OUTPUT_LIMIT = 32 * 1024;
const STARTUP_ALLOWANCE_MS = 15_000;
const LOST_HELPER_CLOSE_MS = 5_000;

/** Executes only a previously authenticated explicit helper, with ordinary
 * argv quoting (no shell and no verbatim command interpolation). The native
 * helper owns the Job; a missing receipt/close never authorizes profile removal. */
export async function launchLightscaperWindowsJobProcessCurrentV1(admission: LightscaperWindowsJobAdmissionCurrentV1,
	args: readonly string[], options: Readonly<{ nonce: string; stage: 1 | 2 | 3; receiptPath: string;
		deadlineMs?: number; retirementGraceMs?: number }>,
): Promise<LightscaperWindowsManagedProcessReceiptCurrentV1> {
	assertLightscaperWindowsJobIdentityCurrentV1(options.nonce, options.stage);
	const deadline = duration(options.deadlineMs ?? 210_000, 210_000), grace = duration(options.retirementGraceMs ?? 5_000, 5_000);
	if (!Array.isArray(args) || args.length > 128 || args.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 32_768)) throw new TypeError('Windows Job argv must be bounded literal strings.');
	await revalidateLightscaperWindowsJobAdmissionCurrentV1(admission);
	await assertFreshReceiptPath(options.receiptPath, options.nonce, options.stage);
	return new Promise(resolveReceipt => {
		const child = spawn(admission.helper.path, [
			`--receipt=${options.receiptPath}`, `--nonce=${options.nonce}`, `--stage=${options.stage}`,
			`--deadline-ms=${deadline}`, `--grace-ms=${grace}`, '--', admission.executable, ...args,
		], { cwd: dirname(admission.executable), env: process.env, shell: false, windowsHide: true,
			windowsVerbatimArguments: false, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout: Buffer = Buffer.alloc(0), stderr: Buffer = Buffer.alloc(0), launchError: string | null = null;
		let terminal = false, outerExpired = false;
		let lostClose: ReturnType<typeof setTimeout> | undefined;
		const finish = (helperClosed: boolean, helperExitCode: number | null, helperSignal: string | null): void => {
			if (terminal) return;
			terminal = true; clearTimeout(outerTimer); if (lostClose) clearTimeout(lostClose);
			if (!helperClosed) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
			void readTerminal(helperClosed, helperExitCode).then(native => {
				resolveReceipt(lightscaperWindowsJobProcessReceiptCurrentV1({ target: admission.helper.target,
					helperSha256: admission.helper.sha256, helperProcessId: child.pid ?? 0, helperExitCode,
					helperSignal, helperClosed, outerExpired, receipt: native },
				{ stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), launchError }));
			}, (error: unknown) => {
				launchError = appendError(launchError, error);
				resolveReceipt(lightscaperWindowsJobProcessReceiptCurrentV1({ target: admission.helper.target,
					helperSha256: admission.helper.sha256, helperProcessId: child.pid ?? 0, helperExitCode,
					helperSignal, helperClosed, outerExpired, receipt: null },
				{ stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), launchError }));
			});
		};
		const readTerminal = async (closed: boolean, exitCode: number | null): Promise<LightscaperWindowsJobReceiptCurrentV1 | null> => {
			if (!closed || outerExpired || exitCode !== 0) return null;
			return readLightscaperWindowsJobReceiptCurrentV1(JSON.parse((await readBoundedReceipt(options.receiptPath)).toString('utf8')) as unknown,
				{ nonce: options.nonce, stage: options.stage });
		};
		// Longer than all bounded native cleanup paths; it is a fallback against
		// a broken supervisor, never a substitute for its native empty-Job proof.
		const outerTimer = setTimeout(() => {
			outerExpired = true; launchError = appendError(launchError, new Error('Windows Job supervisor exceeded its outer deadline.'));
			try { if (!child.kill('SIGKILL')) launchError = appendError(launchError, new Error('Windows Job supervisor kill was not admitted.')); }
			catch (error) { launchError = appendError(launchError, error); }
			lostClose = setTimeout(() => { finish(false, null, null); }, LOST_HELPER_CLOSE_MS);
		}, deadline + 3 * grace + STARTUP_ALLOWANCE_MS);
		child.stdout.on('data', (bytes: Buffer) => { stdout = tail(stdout, bytes); });
		child.stderr.on('data', (bytes: Buffer) => { stderr = tail(stderr, bytes); });
		child.on('error', error => { launchError = appendError(launchError, error); });
		child.once('close', (code, signal) => { finish(true, code, signal); });
	});
}

async function assertFreshReceiptPath(path: string, nonce: string, stage: number): Promise<void> {
	if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')
		|| basename(path) !== `${nonce}.stage-${stage}.windows-job.json`) throw new TypeError('Windows Job receipt must be the exact fresh private stage path.');
	const parent = dirname(path), metadata = await lstat(parent);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(parent) !== parent) throw new Error('Windows Job receipt parent must be a canonical private directory.');
	try { await lstat(path); }
	catch (error) { if (isMissing(error)) return; throw error; }
	throw new Error('Windows Job receipt already exists.');
}
async function readBoundedReceipt(path: string): Promise<Buffer> {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || before.size < 1
		|| before.size > LIGHTSCAPER_WINDOWS_JOB_RECEIPT_MAXIMUM_BYTES_CURRENT_V1 || await realpath(path) !== path) throw new Error('Windows Job receipt is not one bounded canonical regular file.');
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = await handle.stat();
		if (!sameFile(before, opened)) throw new Error('Windows Job receipt changed while opening.');
		const bytes = Buffer.alloc(opened.size); let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
			if (!bytesRead) break;
			offset += bytesRead;
		}
		const after = await handle.stat(), atPath = await lstat(path);
		if (offset !== bytes.length || !sameFile(opened, after) || !sameFile(after, atPath) || atPath.isSymbolicLink()) throw new Error('Windows Job receipt changed while reading.');
		return bytes;
	} finally { await handle.close(); }
}
function sameFile(a: Readonly<{ size: number; mtimeMs: number; ctimeMs: number; ino: number; dev: number }>,
	b: Readonly<{ size: number; mtimeMs: number; ctimeMs: number; ino: number; dev: number }>): boolean {
	return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
		&& (a.ino === 0 || b.ino === 0 || (a.ino === b.ino && a.dev === b.dev));
}
function tail(previous: Buffer, bytes: Buffer): Buffer {
	if (bytes.length >= OUTPUT_LIMIT) return Buffer.from(bytes.subarray(bytes.length - OUTPUT_LIMIT));
	const joined = Buffer.concat([previous, bytes]); return joined.subarray(Math.max(0, joined.length - OUTPUT_LIMIT));
}
function appendError(previous: string | null, error: unknown): string {
	return `${previous ? `${previous} ` : ''}${error instanceof Error ? error.message : 'Unknown Windows Job supervisor failure.'}`.slice(-OUTPUT_LIMIT);
}
function isMissing(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'; }
function duration(value: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Windows Job duration exceeds its native bound.');
	return value;
}
