/* SPDX-License-Identifier: AGPL-3.0-only */
import { ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { NativeReader, NativeWriter, nativeRetirementIsUnproved, readNativeError } from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
const APPLY = Reflect.apply;
type Missing = 'root-missing' | 'file-missing';
const MISSING = new WeakMap<object, Missing>();
/** Only actual pending native ROOT_OPEN/FILE_OPEN replies can mint a witness.
 * Public Error classes, decoded caller frames and diagnostics grant nothing. */
export function readNativeFilesystemMissingCurrentV1(value: unknown): Missing | null {
	return typeof value === 'object' && value !== null ? MISSING.get(value) ?? null : null;
}
type Pending = Readonly<{ opcode: number; maximum: number; resolve(value: Uint8Array): void; reject(reason: unknown): void }>;
export function nativeFilesystemTargetCurrentV1(): number {
	if (process.platform === 'linux' && process.arch === 'x64') return 1;
	if (process.platform === 'linux' && process.arch === 'arm64') return 2;
	if (process.platform === 'darwin' && process.arch === 'arm64') return 3;
	if (process.platform === 'win32' && process.arch === 'x64') return 4;
	if (process.platform === 'win32' && process.arch === 'arm64') return 5;
	throw new Error('Native granted filesystem target is unsupported.');
}
/** Owns the actual child and stdio. No executable path or alternate loader. */
export class NativeFilesystemProcessCurrentV1 {
	#child: ChildProcessWithoutNullStreams; #write: ChildProcessWithoutNullStreams['stdin']['write'];
	#pending = new Map<number, Pending>(); #writes = new Set<Promise<void>>();
	#sequence = 0; #input = Buffer.alloc(0); #stderr = 0;
	#closed = false; #closing = false; #failure: unknown; #hasFailure = false;
	#joined: Promise<void>; #close?: Promise<void>;
	#unproved: (failure: unknown) => void;
	constructor(start: () => ChildProcessWithoutNullStreams, unproved: (failure: unknown) => void) {
		this.#unproved = unproved;
		const child = start();
		if (!(child instanceof ChildProcess) || !child.stdin || !child.stdout || !child.stderr) throw new TypeError('Trusted native filesystem start must return the actual piped child.');
		this.#child = child; this.#write = child.stdin.write;
		this.#joined = new Promise<void>(resolve => {
			child.once('close', (code, signal) => {
				this.#closed = true;
				if (!this.#closing) this.#fail(new Error(`Native granted filesystem exited (${String(code)}, ${String(signal)}).`));
				const reason = this.#hasFailure ? this.#failure : new Error('Native granted filesystem retired before reply.');
				for (const pending of this.#pending.values()) pending.reject(reason); this.#pending.clear(); resolve();
			});
		});
		child.on('error', error => { this.#fail(error); this.#kill(); });
		child.stdin.on('error', error => { if (!this.#closing) this.#fail(error); this.#kill(); });
		child.stdout.on('error', error => { this.#fail(error); this.#kill(); });
		child.stderr.on('error', error => { this.#fail(error); this.#kill(); });
		child.stdout.on('data', (bytes: Buffer) => { this.#receive(bytes); });
		child.stderr.on('data', (bytes: Buffer) => { this.#stderr += bytes.byteLength; if (this.#stderr > 8192) { this.#fail(new Error('Native filesystem diagnostic capacity exceeded.')); this.#kill(); } });
	}
	#fail(reason: unknown): void { if (!this.#hasFailure) { this.#hasFailure = true; this.#failure = reason; } }
	#kill(): void { if (!this.#closed) this.#child.kill('SIGKILL'); }
	#receive(bytes: Buffer): void {
		try {
			if (this.#input.byteLength + bytes.byteLength > 2 * 1048576) throw new Error('Native filesystem response buffer exceeds its bound.');
			this.#input = Buffer.concat([this.#input, bytes]);
			while (this.#input.length >= 16) {
				const header = this.#input;
				if (header.subarray(0, 4).toString() !== 'SGR1' || header[4] !== 1 || header.readUInt16BE(6) !== 0) throw new Error('Native filesystem response header is invalid.');
				const id = header.readUInt32BE(8), opcode = header[5]!, length = header.readUInt32BE(12), pending = this.#pending.get(id);
				if (!pending || (opcode !== 255 && opcode !== (pending.opcode | 128)) || length > (opcode === 255 ? 1034 : pending.maximum)) throw new Error('Native filesystem returned an unowned response.');
				if (this.#input.length < 16 + length) break;
				const body = new Uint8Array(this.#input.subarray(16, 16 + length)); this.#input = this.#input.subarray(16 + length);
				if (opcode === 255) {
					const error = readNativeError(body);
					if (error.phase !== pending.opcode) throw new Error('Native filesystem error belongs to another operation.');
					if (nativeRetirementIsUnproved(error)) this.#unproved(error);
					else if (error.code === 7 && (error.nativeCode === 2 || (process.platform === 'win32' && error.nativeCode === 3))) {
						if (pending.opcode === 2) MISSING.set(error, 'root-missing');
						else if (pending.opcode === 4) MISSING.set(error, 'file-missing');
					}
					pending.reject(error);
				} else pending.resolve(body); this.#pending.delete(id);
			}
		} catch (error) { this.#fail(error); this.#kill(); }
	}
	assertCurrent(): void { if (this.#closed || this.#closing || this.#hasFailure) throw this.#hasFailure ? this.#failure : new Error('Native filesystem process is retired.'); }
	get isRetired(): boolean { return this.#closed; }
	request(opcode: number, body: Uint8Array, maximum: number, cleanup = false): Promise<Uint8Array> {
		if (this.#closed || (this.#closing && !cleanup)) return Promise.reject(this.#hasFailure ? this.#failure : new Error('Native filesystem process is retired.'));
		if (this.#sequence >= 0xffffffff || this.#pending.size >= 4164 || body.byteLength > 262144) return Promise.reject(new RangeError('Native filesystem wire capacity exceeded.'));
		const id = ++this.#sequence, frame = Buffer.alloc(16 + body.byteLength);
		frame.write('SGR1'); frame[4] = 1; frame[5] = opcode; frame.writeUInt32BE(id, 8); frame.writeUInt32BE(body.byteLength, 12); frame.set(body, 16);
		const reply = new Promise<Uint8Array>((resolve, reject) => { this.#pending.set(id, { opcode, maximum, resolve, reject }); });
		const write = new Promise<void>((resolve, reject) => {
			try { APPLY(this.#write, this.#child.stdin, [frame, (error?: Error | null) => { if (error) { reject(error); if (!this.#closing) this.#fail(error); this.#kill(); } else resolve(); }]); }
			catch (error) { reject(error); if (!this.#closing) this.#fail(error); this.#kill(); }
		});
		this.#writes.add(write); void write.then(() => { this.#writes.delete(write); }, () => { this.#writes.delete(write); });
		return Promise.all([reply, write]).then(([value]) => value);
	}
	async initialize(): Promise<void> {
		const nonce = randomBytes(32), target = nativeFilesystemTargetCurrentV1();
		const body = await this.request(1, new NativeWriter().raw(nonce).number(target, 1).finish(), 53), reader = new NativeReader(body);
		if (Buffer.from(reader.raw(32)).toString('hex') !== nonce.toString('hex') || reader.number(1) !== target
			|| reader.number(2) !== 64 || reader.number(2) !== 4094 || reader.number(1) !== 4 || reader.number(1) !== 4
			|| reader.number(4) !== 1048576 || reader.number(4) !== 262144 || reader.number(2) !== 64 || reader.number(4) !== 65536) throw new Error('Native filesystem INIT profile differs.');
		reader.end();
	}
	close(): Promise<void> {
		if (this.#close) return this.#close;
		let resolve!: () => void, reject!: (reason: unknown) => void;
		this.#close = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); this.#closing = true;
		void this.#retire().then(resolve, reject); return this.#close;
	}
	async #retire(): Promise<void> {
		// A timer requests termination only. Actual child.close includes stdio join.
		const timer = setTimeout(() => { this.#kill(); }, 100);
		try {
			if (!this.#closed) {
				const shutdown = this.request(10, new Uint8Array(), 0, true);
				void shutdown.catch(() => {}); await this.#joined; await Promise.allSettled([shutdown]);
			} else await this.#joined;
			await Promise.allSettled([...this.#writes]);
		} finally { clearTimeout(timer); }
		if (this.#hasFailure) throw this.#failure;
	}
}
