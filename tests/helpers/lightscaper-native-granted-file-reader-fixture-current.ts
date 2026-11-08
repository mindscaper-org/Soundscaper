/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { copyNativeTestFixture } from '../../scripts/lib/node-native-test-fixtures.ts';

export const GRANTED_READER_ERROR = Object.freeze({ invalidPath: 1, rootIdentity: 2, notRegular: 3,
	changed: 4, range: 5, closed: 6, io: 7, link: 8, unsupported: 9 });
export type GrantedFileIdentityCurrentV1 = Readonly<{ volume: string; object: string }>;
export function nativeGrantedPathHexCurrentV1(value: string | Buffer): string {
	const bytes = typeof value === 'string' ? Buffer.from(value, process.platform === 'win32' ? 'utf16le' : 'utf8') : value;
	return bytes.length ? bytes.toString('hex') : '-';
}
export function grantedReaderHashCurrentV1(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

class Peer {
	readonly child: ChildProcessWithoutNullStreams;
	readonly joined: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
	#buffer = ''; #stderr = ''; #failure: unknown; #failed = false; #exited = false;
	#pending?: Readonly<{ resolve(value: string): void; reject(error: unknown): void }>;
	#closing?: Promise<void>;
	constructor(binary: string) {
		this.child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
		this.joined = new Promise(resolve => { this.child.once('close', (code, signal) => { this.#exited = true;
			this.#fail(new Error(`Granted native fixture retired: ${String(code)}/${String(signal)} ${this.#stderr}`)); resolve({ code, signal }); }); });
		this.child.once('error', error => this.#fail(error));
		this.child.stdin.on('error', error => this.#fail(error));
		this.child.stdout.on('error', error => this.cancel(error));
		this.child.stderr.on('data', (value: Buffer) => { if (this.#stderr.length < 4096) this.#stderr += value.toString('utf8').slice(0, 4096 - this.#stderr.length); });
		this.child.stdout.on('data', (value: Buffer) => {
			if (this.#buffer.length + value.byteLength > 2 * 1048576 + 512) { this.cancel(new RangeError('Native fixture reply exceeded its bound.')); return; }
			this.#buffer += value.toString('ascii'); const index = this.#buffer.indexOf('\n'); if (index < 0) return;
			const line = this.#buffer.slice(0, index); this.#buffer = this.#buffer.slice(index + 1);
			const pending = this.#pending; this.#pending = undefined;
			if (!pending || this.#buffer.length) { this.cancel(new Error('Native fixture returned an unsolicited reply.')); return; }
			pending.resolve(line);
		});
	}
	request(command: string): Promise<string> {
		if (this.#failed) return Promise.reject(this.#failure);
		if (this.#pending || this.#exited) return Promise.reject(new Error('Native fixture request lane is not available.'));
		return new Promise((resolve, reject) => {
			this.#pending = { resolve, reject };
			this.child.stdin.write(`${command}\n`, error => { if (error) this.#fail(error); });
		});
	}
	cancel(reason: unknown): void { this.#fail(reason); if (!this.#exited) this.child.kill('SIGKILL'); }
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closing = (async () => {
			let failed = false, primary: unknown;
			const normal = !this.#failed && !this.#exited && !this.#pending;
			try { if (normal) { assert.equal(await this.request('EXIT'), 'BYE'); this.child.stdin.end(); } }
			catch (error) { failed = true; primary = error; }
			if ((!normal || failed) && !this.#exited) this.child.kill('SIGKILL');
			const outcome = await this.joined;
			if (failed) throw primary;
			if (normal) assert.equal(outcome.code, 0);
		})(); return this.#closing;
	}
	#fail(error: unknown): void { if (!this.#failed) { this.#failed = true; this.#failure = error; }
		const pending = this.#pending; this.#pending = undefined; pending?.reject(this.#failure); }
}

export async function nativeGrantedReaderFixtureCurrentV1(context: TestContext,
	run: (fixture: ReturnType<typeof fixtureFor>) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-granted-reader-'));
	const root = join(directory, 'root'), outside = join(directory, 'outside');
	let peer: Peer | undefined, timer: ReturnType<typeof setTimeout> | undefined;
	const cancel = (): void => peer?.cancel(context.signal.reason ?? new Error('Native reader test deadline.'));
	context.signal.addEventListener('abort', cancel, { once: true });
	try {
		const binary = process.env.SCAPE_GRANTED_FILE_READER_TEST_BINARY ?? join(directory, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
		if (!process.env.SCAPE_GRANTED_FILE_READER_TEST_BINARY) assert.ok(copyNativeTestFixture({ repositoryRoot: fileURLToPath(new URL('../../', import.meta.url)),
			kind: 'lightscaper-granted-file-reader', outputPath: binary }), 'Prepare the actual shared native reader fixture.');
		assert.ok(isAbsolute(binary)); assert.equal((await lstat(binary)).isFile(), true);
		await mkdir(root); await mkdir(outside); await mkdir(join(root, 'nested'));
		const bytes = Buffer.from('authorized tiny Original\n'), foreign = Buffer.from('outside sentinel Original\n');
		await writeFile(join(root, 'photo.bin'), bytes); await writeFile(join(root, 'nested', 'photo.bin'), bytes);
		await writeFile(join(outside, 'photo.bin'), foreign);
		peer = new Peer(binary); timer = setTimeout(() => { peer?.cancel(new Error('Native reader active14s deadline.')); }, 14000);
		if (context.signal.aborted) cancel();
		await run(fixtureFor(peer, directory, root, outside, bytes, foreign));
	} finally {
		try { await peer?.close(); }
		finally { if (timer) clearTimeout(timer); context.signal.removeEventListener('abort', cancel); await rm(directory, { recursive: true, force: true }); }
	}
}
function fixtureFor(peer: Peer, directory: string, root: string, outside: string, bytes: Buffer, foreign: Buffer) {
	const capture = async (path: string, expected?: GrantedFileIdentityCurrentV1): Promise<GrantedFileIdentityCurrentV1> => {
		const line = await peer.request(`ROOT ${nativeGrantedPathHexCurrentV1(path)} ${expected ? Buffer.from(expected.volume).toString('hex') : '-'} ${expected ? Buffer.from(expected.object).toString('hex') : '-'}`);
		assert.match(line, /^ROOT [a-f0-9]+ [a-f0-9]+$/u);
		const [, volume, object] = line.split(' '); return Object.freeze({ volume: Buffer.from(volume!, 'hex').toString(), object: Buffer.from(object!, 'hex').toString() });
	};
	return Object.freeze({ directory, root, outside, bytes, foreign, capture,
		request: (command: string) => peer.request(command),
		open: (components: readonly (string | Buffer)[]) => peer.request(`OPEN ${String(components.length)} ${components.map(nativeGrantedPathHexCurrentV1).join(' ')}`.trimEnd()),
		read: async (offset: number | bigint, length: number): Promise<Buffer> => {
			const line = await peer.request(`READ ${String(offset)} ${String(length)}`); assert.match(line, /^DATA (?:[a-f0-9]+|-)$/u);
			return line === 'DATA -' ? Buffer.alloc(0) : Buffer.from(line.slice(5), 'hex');
		},
		cancel: (reason: unknown) => peer.cancel(reason), joined: peer.joined,
	});
}
