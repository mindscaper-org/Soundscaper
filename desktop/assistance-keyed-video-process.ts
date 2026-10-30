/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded main-only inspection commands; no output bytes cross the control port. */
import { curatedExternalFfmpegEnvironment, privateExternalFfmpegEnvironment } from './external-ffmpeg-environment.ts';
import { spawnExternalFfmpegProcess, superviseExternalFfmpegProcess } from './external-ffmpeg-process-security.ts';
import { shouldDetachProcessTree } from './process-tree-termination.ts';

export async function captureKeyedVideoProcess(options: Readonly<{
	executablePath: string; arguments: readonly string[]; directory: string; signal: AbortSignal;
	maximumBytes: number; maximumDurationMs?: number;
}>): Promise<string> {
	options.signal.throwIfAborted();
	const child = spawnExternalFfmpegProcess(options.executablePath, options.arguments, {
		cwd: options.directory, env: privateExternalFfmpegEnvironment(process.env, options.directory),
		stdio: ['ignore', 'pipe', 'pipe'], detached: shouldDetachProcessTree(),
	});
	const failure = (): Error => new Error('The alpha-video inspection process failed.');
	const supervision = superviseExternalFfmpegProcess<Error, Error, void>({ child, signal: options.signal,
		environment: curatedExternalFfmpegEnvironment(process.env),
		maximumDurationMs: options.maximumDurationMs ?? 30 * 60_000, terminationGraceMs: 1000, killWaitMs: 5000,
		timeout: failure, cancelled: () => new DOMException('Alpha-video inspection was cancelled.', 'AbortError'),
		terminated: (error) => { throw error; }, error: () => { throw failure(); },
		close: (code, signal) => { if (code !== 0 || signal !== null) throw failure(); },
	});
	const chunks: Buffer[] = []; let bytes = 0; let stderrBytes = 0;
	child.stdout!.on('data', (chunk: Buffer) => {
		if (!supervision.acceptsOutput()) return;
		bytes += chunk.byteLength;
		if (bytes > options.maximumBytes) supervision.terminate(new Error('Alpha-video inspection output exceeded its bound.'));
		else chunks.push(Buffer.from(chunk));
	});
	child.stderr!.on('data', (chunk: Buffer) => {
		stderrBytes += chunk.byteLength;
		if (stderrBytes > 1024 * 1024) supervision.terminate(new Error('Alpha-video inspection diagnostics exceeded their bound.'));
	});
	await supervision.completion;
	return Buffer.concat(chunks).toString('utf8');
}

/** Every alpha plane must survive the actual libvpx decoder byte-for-byte. */
export function assertKeyedVideoAlphaHashes(text: string, expected: readonly string[], width: number, height: number): void {
	const lines = text.split(/\r?\n/u).filter((line) => line.trim() && !line.startsWith('#'));
	if (lines.length !== expected.length) throw new Error('Alpha-video decoding changed the frame count.');
	for (const [index, line] of lines.entries()) {
		const parts = line.split(',').map((part) => part.trim());
		if (parts.length !== 6 || parts[0] !== '0' || parts[4] !== String(width * height) || parts[5] !== expected[index]) {
			throw new Error('Alpha-video decoding changed an alpha plane.');
		}
	}
}
