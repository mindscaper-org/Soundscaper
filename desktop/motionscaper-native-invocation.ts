/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawn } from 'node:child_process';
import type { MotionNativeExecutable } from './motionscaper-native-payload.ts';

export function executeMotionscaperNativeHelper(executable: MotionNativeExecutable, args: readonly string[], signal: AbortSignal, timeoutMs: number): Promise<string> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(executable.path, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
			env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC', ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) } });
		let stdout = ''; let stderr = ''; let bytes = 0; let failure: Error | null = null;
		let force: ReturnType<typeof setTimeout> | undefined;
		const terminate = (error: Error) => { if (failure) return; failure = error; child.kill(); force = setTimeout(() => { child.kill('SIGKILL'); }, 2000); };
		const abort = () => { terminate(new Error('Motionscaper native operation was cancelled.')); };
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		const timeout = setTimeout(() => { terminate(new Error('Motionscaper native helper exceeded its execution deadline.')); }, timeoutMs);
		const collect = (kind: 'stdout' | 'stderr', data: Buffer) => {
			bytes += data.byteLength;
			if (bytes > 64 * 1024) { terminate(new Error('Motionscaper native helper exceeded its output limit.')); return; }
			if (kind === 'stdout') stdout += data.toString('utf8'); else stderr += data.toString('utf8');
		};
		child.stdout.on('data', (data: Buffer) => { collect('stdout', data); });
		child.stderr.on('data', (data: Buffer) => { collect('stderr', data); });
		child.on('error', (error) => { failure = error; });
		child.on('close', (code) => {
			clearTimeout(timeout); if (force) clearTimeout(force); signal.removeEventListener('abort', abort);
			if (failure || code !== 0) reject(failure ?? new Error(`Motionscaper native helper failed (${String(code)}): ${stderr.trim()}`)); else resolve(stdout);
		});
	});
}
