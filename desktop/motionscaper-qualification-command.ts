/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { motionSustainedCommand } from '../scripts/performance/motionscaper-sustained-command.ts';
import { hashMotionSustainedFile } from '../scripts/performance/motionscaper-sustained-observation.ts';
import { createMotionQualificationNative, type MotionNativeLaunch } from './motionscaper-qualification-native.ts';

export interface MotionQualificationCommandOptions {
	readonly command: string; readonly args: readonly string[]; readonly cwd: string; readonly directory: string; readonly id: string;
	readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number; readonly maximumOutputBytes?: number;
}
type MotionQualificationTerminal = Awaited<MotionNativeLaunch['closed']>;
export function motionQualificationOutputLimit(value = 65536): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 2 * 1024 * 1024) throw new Error('Invalid qualification command output bound.');
	return value;
}
/** Linux retains its reviewed command owner; other hosts require a native job/session controller. */
export async function runMotionQualificationCommand(options: MotionQualificationCommandOptions) {
	const maximumOutputBytes = motionQualificationOutputLimit(options.maximumOutputBytes);
	const timeoutMs = options.timeoutMs ?? 60000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000 || !/^[a-z][a-z0-9-]{0,63}$/u.test(options.id)) throw new Error('Invalid qualification command admission.');
	if (process.platform === 'linux') {
		if (maximumOutputBytes !== 65536) throw new Error('The reviewed Linux command owner retains its 64 KiB output bound.');
		return motionSustainedCommand(options);
	}
	const native = await createMotionQualificationNative(resolve(import.meta.dirname, '..'), options.directory);
	const startedAt = new Date().toISOString();
	let launch: MotionNativeLaunch | undefined, stdout = '', stderr = '', bytes = 0, failure: string | null = null;
	let terminal: MotionQualificationTerminal | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let closed: Promise<MotionQualificationTerminal> | undefined;
	let ownerRecord: Awaited<MotionNativeLaunch['admitted']> | null = null;
	try {
		launch = await native.start({ executable: options.command, args: options.args, cwd: options.cwd, id: options.id,
			timeoutMs, maximumOutputBytes, env: options.env ?? process.env });
		const child = launch.child;
		child.stdin.on('error', (error: Error) => { if (!terminal && !failure) failure = String(error); });
		const collect = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > maximumOutputBytes) { failure ??= 'Native command output exceeded its bound.'; child.stdin.destroy(); return; }
			if (stream === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
		};
		child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk)); child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
		closed = launch.closed;
		ownerRecord = await launch.admitted;
		const expired = new Promise<null>(done => { timer = setTimeout(() => { failure ??= 'Native controller did not close within its owned deadline.'; child.stdin.destroy(); done(null); }, timeoutMs + 20000); });
		terminal = await Promise.race([closed, expired]);
		if (!terminal) { child.unref(); child.stdout.destroy(); child.stderr.destroy(); }
	} catch (error) {
		failure ??= String(error); launch?.child.stdin.destroy();
		if (closed) {
			let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
			try { terminal = await Promise.race([closed, new Promise<null>(done => { cleanupTimer = setTimeout(() => done(null), 20000); })]); }
			finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
		}
	} finally { if (timer) clearTimeout(timer); }
	let closure: unknown = null;
	try { if (launch?.closureFile) closure = JSON.parse(await readFile(launch.closureFile, 'utf8')) as unknown; }
	catch (error) { failure ??= `Native physical closure receipt unavailable: ${String(error)}`; }
	const nativeClosure = closure as { physicalClosed?: boolean; exitCode?: number; timedOut?: boolean; failure?: unknown; remainingOwned?: unknown } | null;
	const empty = Array.isArray(nativeClosure?.remainingOwned) ? nativeClosure.remainingOwned.length === 0 : nativeClosure?.remainingOwned === 0;
	const accepted = !failure && terminal?.code === 0 && terminal.signal === null && nativeClosure?.physicalClosed === true
		&& nativeClosure.exitCode === 0 && nativeClosure.timedOut === false && nativeClosure.failure === null && empty;
	const path = join(options.directory, `${options.id}-command.json`);
	await writeFile(path, `${JSON.stringify({ argv: [options.command, ...options.args], cwd: options.cwd, startedAt, closedAt: new Date().toISOString(),
		terminal, ownerRecord, nativeClosure: closure, failure, maximumOutputBytes, bytes, closureObserved: accepted,
		outputWritersClosed: accepted, stdout, stderr, scope: 'The native controller retains its owned job/session and caller-EOF cleanup authority through physical closure.' }, null, 2)}\n`, { flag: 'wx' });
	const receipt = await hashMotionSustainedFile(path, 8 * 1024 * 1024);
	if (!accepted) throw new Error(`Native qualification command failed or physical closure is unknown; receipt retained at ${path}.`);
	return { stdout, stderr, receipt };
}
