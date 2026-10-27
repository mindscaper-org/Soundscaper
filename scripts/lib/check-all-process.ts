/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Writable } from 'node:stream';

export const CHECK_ALL_MEMORY_BYTES = 8 * 1024 ** 3;

export function limitedProcessArguments(root: string, unit: string, args: readonly string[], memoryBytes = CHECK_ALL_MEMORY_BYTES): string[] {
	return [
		'--user', '--scope', '--quiet', '--collect', '--expand-environment=no',
		`--unit=${unit}`, `--property=MemoryMax=${memoryBytes}`, '--property=MemorySwapMax=0',
		'--', process.execPath, resolve(root, 'scripts/check-all-task.ts'), String(memoryBytes), ...args,
	];
}

/** A cgroup accounts for native allocations and descendants, including detached ones. */
export function startLimitedProcess(root: string, id: string, args: readonly string[], options: {
	env?: NodeJS.ProcessEnv;
	memoryBytes?: number;
	log?: Writable;
	onOutput?: (chunk: Buffer, stderr: boolean) => void;
} = {}) {
	if (process.platform !== 'linux') throw new Error('check-all requires Linux, cgroup v2 and a systemd user session to enforce its memory limits.');
	const unit = `scape-check-${id.replace(/[^a-z0-9-]/giu, '-')}-${randomUUID()}.scope`;
	const child = spawn('systemd-run', limitedProcessArguments(root, unit, args, options.memoryBytes), {
		cwd: root, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
	});
	if (options.log) {
		child.stdout.pipe(options.log, { end: false });
		child.stderr.pipe(options.log, { end: false });
	}
	let stopping: Promise<void> | undefined;
	const stop = (): Promise<void> => {
		stopping ??= (async () => {
			// Kill the entire scope before stopping it; no graceful-stop timeout can
			// leave native grandchildren running after Ctrl-C or a failed shard.
			await controlUnit('kill', ['--signal=SIGKILL', '--kill-whom=all', unit]);
			await controlUnit('stop', [unit]);
			if (child.exitCode === null && child.signalCode === null && child.pid) {
				try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
				}
			}
		})();
		return stopping;
	};
	const completed = new Promise<number>((resolveCompletion, reject) => {
		child.once('error', reject);
		child.stdout.on('data', (chunk: Buffer) => options.onOutput?.(chunk, false));
		child.stderr.on('data', (chunk: Buffer) => options.onOutput?.(chunk, true));
		// A native grandchild might retain a pipe after the command exits. Clean
		// the scope on exit as well as on explicit cancellation, before close.
		child.once('exit', () => { void stop().catch(reject); });
		child.once('close', (code, signal) => {
			void stop().then(() => resolveCompletion(code ?? (signal === 'SIGINT' ? 130 : 1)), reject);
		});
	});
	return { completed, stop, unit };
}

function controlUnit(action: string, args: string[]): Promise<void> {
	return new Promise((resolveControl, reject) => {
		const child = spawn('systemctl', ['--user', action, ...args], { stdio: 'ignore' });
		child.once('error', reject);
		// Finished transient scopes have already been collected; stopping one
		// again is harmless and returns a nonzero status.
		child.once('close', () => resolveControl());
	});
}
