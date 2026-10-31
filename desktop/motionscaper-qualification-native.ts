/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { parseMotionProcessStat } from '../scripts/performance/motionscaper-sustained-process.ts';
import { verifyMotionQualificationOwner, verifyMotionQualificationWindowsProbe, type MotionQualificationOwner } from './motionscaper-qualification-policy.ts';

export interface MotionQualificationProcess extends MotionQualificationOwner { readonly group?: number; readonly session?: number; readonly state?: 'running' | 'zombie' }
export interface MotionQualificationCustody { readonly directory: string; readonly id: string; readonly jobName?: string; readonly controlId: string; readonly group?: number; readonly session?: number }
export interface MotionNativeLaunch {
	readonly child: ChildProcessWithoutNullStreams; readonly closureFile: string | null;
	readonly closed: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
	readonly admitted: Promise<Readonly<{ owner: MotionQualificationOwner; custody: MotionQualificationCustody; controller?: MotionQualificationOwner }>>;
}
const execute = promisify(execFile);
const missing = (error: unknown) => !!error && typeof error === 'object' && ['ENOENT', 'ESRCH'].includes(String(Reflect.get(error, 'code')));
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native controller record.');
	return value as Record<string, unknown>;
}
export function readMotionQualificationOwner(value: unknown): MotionQualificationOwner {
	const row = object(value);
	if (!['linux', 'win32', 'darwin'].includes(String(row.platform)) || typeof row.pid !== 'number' || typeof row.parent !== 'number'
		|| typeof row.birth !== 'string' || typeof row.executable !== 'string') throw new Error('Invalid native process identity.');
	const owner = { platform: row.platform as MotionQualificationOwner['platform'], pid: row.pid, parent: row.parent, birth: row.birth, executable: row.executable };
	verifyMotionQualificationOwner(owner, owner); return owner;
}
function observeChild(child: ChildProcessWithoutNullStreams) {
	let failure: Error | undefined;
	const closed = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(done => {
		child.on('error', error => { failure = error; });
		child.once('close', (code, signal) => done({ code, signal }));
	});
	return { closed, failure: () => failure };
}
function linuxIdentity(pid: number, text: string, executable: string): MotionQualificationProcess {
	const identity = parseMotionProcessStat(text), fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/u);
	return { platform: 'linux', pid, parent: identity.parentPid, birth: identity.startTicks, executable, group: Number(fields[2]), session: Number(fields[3]), state: fields[0] === 'Z' || fields[0] === 'X' ? 'zombie' : 'running' };
}

/** Target-native external controllers retain process authority; no product bridge is imported. */
async function createMotionQualificationNativeInternal(root: string, directory: string) {
	const platform = process.platform;
	if (platform !== 'linux' && platform !== 'win32' && platform !== 'darwin') throw new Error('Unsupported native qualification host.');
	let sequence = 0; const known = new Map<string, MotionQualificationOwner>(), key = (pid: number, birth: string) => `${pid}:${birth}`;
	const darwin = join(directory, 'motion-qualification-process-darwin');
	if (platform === 'darwin') {
		const args = ['-std=c11', '-Wall', '-Wextra', '-Werror', join(root, 'scripts/lib/motionscaper-qualification-process-darwin.c'), '-o', darwin];
		const compiled = await execute('/usr/bin/clang', args, { timeout: 60000, maxBuffer: 65536 });
		await writeFile(join(directory, 'native-process-observer-build.json'), `${JSON.stringify({ command: '/usr/bin/clang', args, ...compiled }, null, 2)}\n`, { flag: 'wx' });
	}
	const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
	const request = async (value: unknown) => {
		const path = join(directory, `native-request-${++sequence}.json`);
		await writeFile(path, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 }); return path;
	};
	const windows = async (value: unknown) => {
		const path = await request(value);
		const result = await execute(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/lib/motionscaper-qualification-win32.ps1'), '-RequestPath', path], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
		return JSON.parse(result.stdout) as unknown;
	};
	const probe = platform === 'win32' ? await windows({ schemaVersion: 1, action: 'probe' }) : null;
	if (platform === 'win32') {
		verifyMotionQualificationWindowsProbe(probe, false);
		await writeFile(join(directory, 'native-windows-probe.json'), `${JSON.stringify(probe, null, 2)}\n`, { flag: 'wx' });
	}
	const requireInteractive = () => { if (platform === 'win32') verifyMotionQualificationWindowsProbe(probe, true); };

	const decode = (value: unknown): MotionQualificationProcess => {
		const row = object(value);
		if (row.state === 'zombie' && row.executable === '' && typeof row.pid === 'number' && typeof row.birth === 'string') {
			const retained = known.get(key(row.pid, row.birth)); if (!retained) throw new Error('Unadmitted zombie process birth.');
			return { ...retained, state: 'zombie' };
		}
		const owner = readMotionQualificationOwner(row); known.set(key(owner.pid, owner.birth), owner);
		return { ...owner, ...(typeof row.group === 'number' ? { group: row.group } : {}), ...(typeof row.session === 'number' ? { session: row.session } : {}), state: row.state === 'zombie' ? 'zombie' : 'running' };
	};
	const inspect = async (pid: number): Promise<MotionQualificationProcess | null> => {
		if (platform === 'linux') {
			let text: string;
			try { text = await readFile(`/proc/${pid}/stat`, 'utf8'); } catch (error) { if (missing(error)) return null; throw error; }
			let executable: string;
			try { executable = await readlink(`/proc/${pid}/exe`); } catch (error) {
				if (!missing(error)) throw error;
				const parsed = parseMotionProcessStat(text), retained = known.get(key(pid, parsed.startTicks));
				const state = text.slice(text.lastIndexOf(')') + 2).split(' ')[0];
				if (!retained || state !== 'Z' && state !== 'X') throw new Error('Live process executable is unavailable.', { cause: error });
				executable = retained.executable;
			}
			const value = linuxIdentity(pid, text, executable); known.set(key(pid, value.birth), value); return value;
		}
		const value = platform === 'win32' ? await windows({ schemaVersion: 1, action: 'inspect', pid })
			: JSON.parse((await execute(darwin, ['inspect', String(pid)], { timeout: 5000, maxBuffer: 65536 })).stdout) as unknown;
		return value === null ? null : decode(value);
	};
	const snapshot = async (): Promise<Readonly<{ processes: readonly MotionQualificationProcess[]; visibilityGaps: unknown }>> => {
		if (platform === 'linux') {
			const names = (await readdir('/proc')).filter(value => /^[1-9]\d*$/u.test(value)); if (names.length > 65536) throw new Error('Process census exceeded its bound.');
			const processes: MotionQualificationProcess[] = [];
			for (const name of names) {
				try {
					const text = await readFile(`/proc/${name}/stat`, 'utf8');
					if (['Z', 'X'].includes(text.slice(text.lastIndexOf(')') + 2).split(' ')[0]!)) continue;
					processes.push(linuxIdentity(Number(name), text, await readlink(`/proc/${name}/exe`)));
				} catch (error) { if (!missing(error) && String(Reflect.get(Object(error), 'code')) !== 'EACCES') throw error; }
			}
			return { processes, visibilityGaps: 'Accessible /proc executable paths only; retained births are independently reobserved through physical disappearance.' };
		}
		const value = object(platform === 'win32' ? await windows({ schemaVersion: 1, action: 'snapshot' })
			: JSON.parse((await execute(darwin, ['snapshot'], { timeout: 10000, maxBuffer: 16 * 1024 * 1024 })).stdout) as unknown);
		if (!Array.isArray(value.processes) || value.processes.length > 65536) throw new Error('Invalid native process snapshot.');
		const processes = value.processes.filter((item: unknown) => { const row = object(item); return row.state !== 'zombie' || row.executable !== ''; }).map((item: unknown) => decode(item));
		return { processes, visibilityGaps: value.visibilityGaps };
	};
	const start = async (options: Readonly<{ executable: string; args: readonly string[]; cwd: string; id: string; timeoutMs: number; maximumOutputBytes: number; env: NodeJS.ProcessEnv }>): Promise<MotionNativeLaunch> => {
		const executable = await realpath(options.executable);
		if (platform === 'linux') {
			const child = spawn(executable, [...options.args], { cwd: options.cwd, env: options.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }); child.stdin.end();
			// Return the actual ChildProcess even on admission failure so cleanup retains direct unreaped-child authority.
			const observation = observeChild(child);
			const admitted = (async () => {
				if (!child.pid) throw new Error('Owned application PID unavailable.');
				const owner = linuxIdentity(child.pid, readFileSync(`/proc/${child.pid}/stat`, 'utf8'), executable); known.set(key(owner.pid, owner.birth), owner);
				if (owner.group !== child.pid || owner.session !== child.pid) throw new Error('Application did not create its owned session.');
				return { owner, custody: { directory, id: options.id, controlId: `${owner.pid}:${owner.birth}`, group: owner.group, session: owner.session } };
			})();
			return { child, closed: observation.closed, closureFile: null, admitted };
		}
		const ownerFile = join(directory, `${options.id}.owner.json`), closureFile = join(directory, `${options.id}.closure.json`);
		let command: string, args: string[];
		if (platform === 'win32') {
			const path = await request({ schemaVersion: 1, action: 'run', executable, args: options.args, cwd: options.cwd, directory, id: options.id,
				timeoutMs: options.timeoutMs, maximumOutputBytes: options.maximumOutputBytes, ownerFile, closureFile });
			command = powershell; args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/lib/motionscaper-qualification-win32.ps1'), '-RequestPath', path];
		} else { command = darwin; args = ['run', executable, options.cwd, ownerFile, closureFile, String(options.timeoutMs), String(options.maximumOutputBytes), `${process.pid}-${Date.now()}-${++sequence}`, '--', ...options.args]; }
		const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
		const observation = observeChild(child);
		// Stdin deliberately stays open: a native controller treats caller EOF as failed custody and cleans only its owned job/session.
		const admitted = (async () => {
			const deadline = performance.now() + 15000;
			for (;;) {
				const spawnFailure = observation.failure(); if (spawnFailure) throw spawnFailure;
				try {
					const value = object(JSON.parse(await readFile(ownerFile, 'utf8')) as unknown), owner = decode(value.owner), custody = object(value.custody);
					if (owner.executable !== executable || owner.platform !== platform || typeof custody.controlId !== 'string' || !custody.controlId) throw new Error('Native launch authority differs.');
					return { owner, custody: { ...custody, directory, id: options.id, controlId: custody.controlId } as MotionQualificationCustody,
						...(value.controller ? { controller: decode(value.controller) } : {}) };
				} catch (error) { if (!missing(error) || performance.now() >= deadline) throw error; }
				if (child.exitCode !== null || child.signalCode !== null) throw new Error('Native controller ended before owner admission.');
				await delay(25);
			}
		})();
		return { child, closed: observation.closed, closureFile, admitted };
	};
	const signal = async (owner: MotionQualificationOwner, custody: MotionQualificationCustody, selected: 'TERM' | 'KILL') => {
		const current = await inspect(owner.pid); if (!current || current.state === 'zombie') return; verifyMotionQualificationOwner(owner, current);
		if (platform === 'linux') { process.kill(owner.pid, selected === 'TERM' ? 'SIGTERM' : 'SIGKILL'); return; }
		if (platform === 'win32') { await windows({ schemaVersion: 1, action: 'signal', owner, custody, signal: selected }); return; }
		await execute(darwin, ['signal', String(owner.pid), owner.birth, owner.executable, selected], { timeout: 5000, maxBuffer: 65536 });
	};
	return { platform, directory, darwin, request, windows, inspect, snapshot, start, signal, requireInteractive };
}


// Reuse a directory's observer and request sequence: an active chooser must never see its observer replaced.
const nativeOwners = new Map<string, ReturnType<typeof createMotionQualificationNativeInternal>>();
export function createMotionQualificationNative(root: string, directory: string) {
	const key = JSON.stringify([root, directory]); let native = nativeOwners.get(key);
	if (!native) { native = createMotionQualificationNativeInternal(root, directory); nativeOwners.set(key, native); }
	return native;
}
