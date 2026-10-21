/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LightscaperManagedProcessReceiptCurrentV1 {
	readonly processId: number; readonly exitCode: number | null; readonly signal: string | null;
	readonly stdout: string; readonly stderr: string; readonly expired: boolean;
	readonly launchError: string | null; readonly readersRetired: boolean; readonly forcedGroupRetirement: boolean;
	readonly liveReaderIds: readonly number[]; readonly unretiredOwnedGroupId: number | null;
}

/** Each child is a new owned POSIX process group. Its exit alone is not proof
 * that Electron helpers retired: inspect/join the complete group, including on
 * timeout/nonzero/launch failure, and escalate only that owned group as needed.
 * Windows requires its separately qualified native Job Object composition. */
export function launchLightscaperManagedSmokeProcessCurrentV1(executable: string, args: readonly string[],
	options: Readonly<{ deadlineMs?: number; retirementGraceMs?: number }> = {},
): Promise<LightscaperManagedProcessReceiptCurrentV1> {
	if (process.platform === 'win32') return Promise.reject(new Error('Lightscaper Windows managed smoke requires qualified native Job Object retirement.'));
	const deadlineMs = boundedDuration(options.deadlineMs ?? 210_000, 210_000), grace = boundedDuration(options.retirementGraceMs ?? 5_000, 5_000);
	return new Promise(resolve => {
		const child = spawn(executable, [...args], { cwd: dirname(executable), env: process.env,
			stdio: ['ignore', 'pipe', 'pipe'], detached: true });
		let stdout = '', stderr = '', launchError: string | null = null, expired = false, terminal = false;
		let hardStop: ReturnType<typeof setTimeout> | undefined;
		const stop = (signal: NodeJS.Signals): void => {
			try { if (child.pid) signalGroup(child.pid, signal); }
			catch (error) { launchError = `Owned process-group signal failed: ${error instanceof Error ? error.message : 'unknown failure'}`; }
		};
		const deadline = setTimeout(() => {
			expired = true; stop('SIGTERM'); hardStop = setTimeout(() => { stop('SIGKILL'); }, grace);
		}, deadlineMs);
		child.stdout.on('data', (value: Buffer) => { stdout = (stdout + value.toString('utf8')).slice(-32768); });
		child.stderr.on('data', (value: Buffer) => { stderr = (stderr + value.toString('utf8')).slice(-32768); });
		child.on('error', error => { launchError = error.message; });
		child.once('close', (exitCode, signal) => {
			if (terminal) return; terminal = true; clearTimeout(deadline);
			// Do not cancel the timeout escalation until group retirement finished.
			void retireGroup(child.pid, grace).then(retirement => {
				if (hardStop) clearTimeout(hardStop);
				resolve({ processId: child.pid ?? 0, exitCode, signal, stdout, stderr, expired, launchError, ...retirement });
			}, error => {
				resolve({ processId: child.pid ?? 0, exitCode, signal, stdout, stderr, expired,
					launchError: `${launchError ?? ''} Group retirement failed: ${error instanceof Error ? error.message : 'unknown failure'}`,
					readersRetired: false, forcedGroupRetirement: false, liveReaderIds: [], unretiredOwnedGroupId: child.pid ?? null });
			});
		});
	});
}
async function retireGroup(processId: number | undefined, grace: number) {
	if (!processId) return { readersRetired: true, forcedGroupRetirement: false, liveReaderIds: [], unretiredOwnedGroupId: null };
	let live = await pollGroup(processId, grace);
	if (!live.length) return { readersRetired: true, forcedGroupRetirement: false, liveReaderIds: [], unretiredOwnedGroupId: null };
	signalGroup(processId, 'SIGTERM'); live = await pollGroup(processId, grace);
	if (live.length) { signalGroup(processId, 'SIGKILL'); live = await pollGroup(processId, grace); }
	return { readersRetired: live.length === 0, forcedGroupRetirement: true,
		liveReaderIds: process.platform === 'linux' ? live : [], unretiredOwnedGroupId: live.length ? processId : null };
}
async function pollGroup(processId: number, duration: number): Promise<number[]> {
	const until = Date.now() + duration;
	for (;;) {
		const live = await liveGroup(processId);
		if (!live.length || Date.now() >= until) return live;
		await new Promise<void>(resolve => { setTimeout(resolve, 25); });
	}
}
async function liveGroup(processId: number): Promise<number[]> {
	if (process.platform === 'linux') {
		const live: number[] = [];
		for (const entry of await readdir('/proc')) {
			if (!/^\d+$/u.test(entry)) continue;
			try {
				const stat = await readFile(`/proc/${entry}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
				if (fields[0] !== 'Z' && Number(fields[2]) === processId) live.push(Number(entry));
			} catch (error) {
				if (!isMissing(error)) throw error;
			}
		}
		return live;
	}
	try { process.kill(-processId, 0); return [processId]; }
	catch (error) { if (isMissing(error)) return []; throw error; }
}
function signalGroup(processId: number, signal: NodeJS.Signals): void {
	try { process.kill(-processId, signal); } catch (error) { if (!isMissing(error)) throw error; }
}
function isMissing(error: unknown): boolean {
	return !!error && typeof error === 'object' && 'code' in error && (error.code === 'ESRCH' || error.code === 'ENOENT');
}
function boundedDuration(value: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Managed process duration exceeds its bound.');
	return value;
}

/** Bounded observations only: this formatter never grants cleanup or success.
 * Captured streams already belong to the actual joined process owner above. */
export function lightscaperManagedProcessDiagnosticCurrentV1(receipt: LightscaperManagedProcessReceiptCurrentV1): string {
	const limit = 32768, readerLimit = 128;
	const encoded = JSON.stringify({ schemaVersion: 1, kind: 'lightscaper-managed-process-diagnostic-current-v1',
		processId: receipt.processId, exitCode: receipt.exitCode, signal: receipt.signal?.slice(0, 64) ?? null,
		expired: receipt.expired, launchError: receipt.launchError?.slice(-limit) ?? null,
		readersRetired: receipt.readersRetired, forcedGroupRetirement: receipt.forcedGroupRetirement,
		liveReaderCount: receipt.liveReaderIds.length, liveReaderIds: receipt.liveReaderIds.slice(0, readerLimit),
		liveReaderIdsTruncated: receipt.liveReaderIds.length > readerLimit, unretiredOwnedGroupId: receipt.unretiredOwnedGroupId,
		stdout: receipt.stdout.slice(-limit), stderr: receipt.stderr.slice(-limit),
		capturedStdoutCodeUnits: receipt.stdout.length, capturedStderrCodeUnits: receipt.stderr.length });
	if (Buffer.byteLength(encoded) > 1024 * 1024) throw new RangeError('Managed process diagnostic exceeds its closed byte bound.');
	return encoded;
}
