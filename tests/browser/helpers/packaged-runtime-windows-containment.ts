/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn as nodeSpawn } from 'node:child_process';
import { win32 } from 'node:path';

interface TreeKiller {
	once(event: 'error', listener: (error: Error) => void): unknown;
	once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	kill(signal: NodeJS.Signals): boolean;
}

interface Options {
	readonly timeoutMs?: number;
	readonly environment?: NodeJS.ProcessEnv;
	readonly spawn?: (executable: string, args: readonly string[], options: {
		readonly shell: false; readonly windowsHide: true; readonly stdio: 'ignore';
	}) => TreeKiller;
}

/** Keep the parent alive until taskkill has found and terminated its descendants. */
export async function terminateWindowsPackagedRuntimeTree(pid: number, options: Options = {}): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 5_000;
	const environment = options.environment ?? process.env;
	const root = environment.SystemRoot ?? environment.WINDIR;
	if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
		|| typeof root !== 'string' || !win32.isAbsolute(root) || root.includes('\0')) {
		throw new TypeError('Windows runtime containment requires its launched PID, system root, and deadline.');
	}
	const start: NonNullable<Options['spawn']> = options.spawn
		?? ((executable, args, settings) => nodeSpawn(executable, [...args], settings));
	const killer = start(win32.join(root, 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], {
		shell: false, windowsHide: true, stdio: 'ignore',
	});
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (error: Error | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error); else resolve();
		};
		const timer = setTimeout(() => {
			try { killer.kill('SIGKILL'); } catch { /* The containment failure remains authoritative. */ }
			finish(new Error('Windows packaged runtime process tree termination exceeded its deadline.'));
		}, timeoutMs);
		killer.once('error', (cause) => finish(new Error(
			'Windows packaged runtime process tree termination could not start.', { cause },
		)));
		killer.once('close', (code, signal) => finish(code === 0 && signal === null ? null
			: new Error('Windows packaged runtime process tree termination did not complete successfully.')));
	});
}
