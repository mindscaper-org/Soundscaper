/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readBoundedRegularFile } from './bounded-regular-file.ts';

const run = promisify(execFile);
export const FDK_AAC_VERSION = '2.0.3';
export const FDK_RUNTIME_DIR = 'fdk-aac';
const MAXIMUM_EXECUTABLE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_MANIFEST_BYTES = 1024;
type Identity = Readonly<{ executable: string; sha256: string; byteLength: number }>;

export async function loadFdkAacIdentity(desktopRoot: string, runtimeRoot: string, target: string): Promise<Identity | null> {
	const file = await readBoundedRegularFile(join(desktopRoot, 'fdk-aac-manifest.json'), MAXIMUM_MANIFEST_BYTES);
	if (file.status === 'unavailable' && file.reason === 'missing') return null;
	if (file.status !== 'available') throw new Error('The bundled FDK AAC manifest cannot be read.');
	return readFdkAacIdentity(file.bytes, runtimeRoot, target);
}

export function readFdkAacIdentity(bytes: Uint8Array, runtimeRoot: string, target: string): Identity {
	if (bytes.byteLength > MAXIMUM_MANIFEST_BYTES) throw new Error('The bundled FDK AAC manifest is too large.');
	const root = join(runtimeRoot, FDK_RUNTIME_DIR);
	const pin = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
	const { version, byteLength, sha256 } = pin;
	if (version !== FDK_AAC_VERSION || pin.target !== target || typeof sha256 !== 'string'
		|| !/^[a-f0-9]{64}$/u.test(sha256) || typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength)
		|| byteLength < 1 || byteLength > MAXIMUM_EXECUTABLE_BYTES) throw new Error('The bundled FDK AAC manifest is invalid.');
	return Object.freeze({ executable: join(root, target.startsWith('win-') ? 'fdk-aac-tool.exe' : 'fdk-aac-tool'), sha256, byteLength });
}

export async function verifyFdkAacExecutable(identity: Identity): Promise<void> {
	const file = await readBoundedRegularFile(identity.executable, identity.byteLength);
	if (file.status !== 'available' || file.bytes.byteLength !== identity.byteLength
		|| createHash('sha256').update(file.bytes).digest('hex') !== identity.sha256) {
		throw new Error('The bundled FDK AAC executable failed authentication.');
	}
}

export async function runFdkAac(identity: Identity, args: readonly string[], cwd: string,
	timeout: number, signal?: AbortSignal): Promise<string | null> {
	signal?.throwIfAborted();
	await verifyFdkAacExecutable(identity);
	const execution = run(identity.executable, args, {
		cwd, signal, timeout, maxBuffer: 4096, windowsHide: true, killSignal: 'SIGKILL',
		env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {},
	});
	const closed = new Promise<void>(resolve => { execution.child.once('close', () => { resolve(); }); });
	let stdout: string;
	try {
		({ stdout } = await execution);
	} catch (error) {
		// An abort can reject execFile before its child has closed the scratch files.
		await closed;
		signal?.throwIfAborted();
		await verifyFdkAacExecutable(identity);
		if (error instanceof Error && 'code' in error && error.code === 3) return null;
		throw new Error('The bundled FDK AAC executable failed.', { cause: error });
	}
	await verifyFdkAacExecutable(identity);
	signal?.throwIfAborted();
	return stdout.trim();
}

export async function withFdkAacScratch<Result>(root: string, operation: (directory: string) => Promise<Result>): Promise<Result> {
	const directory = await mkdtemp(join(root, 'fdk-aac-'));
	try { return await operation(directory); }
	finally { await rm(directory, { recursive: true, force: true }); }
}

export async function readFdkAacResult(path: string, maximumBytes: number): Promise<Uint8Array> {
	const file = await readBoundedRegularFile(path, maximumBytes);
	if (file.status !== 'available') throw new Error('The FDK AAC scratch output is invalid.');
	return file.bytes;
}

export async function fdkAacOutputSize(path: string, maximumBytes: number): Promise<number> {
	const file = await lstat(path);
	if (!file.isFile() || file.size < 1 || file.size > maximumBytes) throw new Error('The FDK AAC scratch output is invalid.');
	return file.size;
}

export async function verifyFdkPcmFile(path: string, byteLength: number, sha256: string, signal: AbortSignal): Promise<void> {
	if (await fdkAacOutputSize(path, byteLength) !== byteLength) throw new Error('The staged AAC PCM size changed.');
	const hash = createHash('sha256');
	for await (const bytes of createReadStream(path, { signal })) hash.update(bytes as Buffer);
	if (hash.digest('hex') !== sha256) throw new Error('The staged AAC PCM digest changed.');
}
