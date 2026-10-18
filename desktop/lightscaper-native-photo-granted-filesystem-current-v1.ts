/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { registerLightscaperNativeOriginalPhysicalNamespaceCurrentV1 as register } from './lightscaper-native-original-physical-namespace-current-v1.ts';
import { captureComponents, captureIdentity, captureNativePath, GRANTED_FS_OP_CURRENT_V1 as OP, nativeRetirementIsUnproved,
	NativeReader, NativeWriter, ownRecord, readNativePage, type NativeFileIdentity, type NativePage, type NativePath } from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
import { NativeFilesystemProcessCurrentV1 } from './lightscaper-native-photo-granted-filesystem-process-current-v1.ts';
import { captureNativeFilesystemOptions, captureNativeFilesystemSignal, checkNativeFilesystemSignal, linkNativeFilesystemSignal } from './lightscaper-native-photo-granted-filesystem-signal-current-v1.ts';
export type { NativeFileIdentity, NativePath, NativeEntry, NativePage } from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
type Options = Readonly<{ signal?: AbortSignal }>;
export type NativeRoot = Readonly<{ identity: NativeFileIdentity; openFile(components: readonly NativePath[], options?: Options): Promise<NativeFile>;
	openScan(components: readonly NativePath[], options?: Options): Promise<NativeScan>; close(): Promise<void> }>;
export type NativeFile = Readonly<{ identity: NativeFileIdentity; byteLength: number; read(offset: number, length: number, options?: Options): Promise<Uint8Array>; close(): Promise<void> }>;
export type NativeScan = Readonly<{ next(options?: Options): Promise<NativePage>; close(): Promise<void> }>;
type Kind = 'root' | 'file' | 'scan';
type Ref = { id: Buffer; kind: Kind; accepting: boolean; native: boolean; pending: Set<Promise<unknown>>; close?: Promise<void>; done?: boolean };
type Namespace = ReturnType<typeof register>;
const ROLES = new WeakMap<object, Readonly<{ namespace: string; current(): void; openRoot: LightscaperNativePhotoGrantedFilesystemCurrentV1['openRoot'] }>>();
const QUARANTINE = new Set<object>(), RETIREMENT_FAILURES = new WeakSet<object>();
const canonical = (path: string): string => { const value = realpathSync(path); return process.platform === 'win32' ? value.toLowerCase() : value; };
export function lightscaperNativePhotoGrantedFilesystemRetirementIsUnprovedCurrentV1(value: unknown): boolean {
	return nativeRetirementIsUnproved(value) || (typeof value === 'object' && value !== null && RETIREMENT_FAILURES.has(value));
}
export function captureLightscaperNativePhotoGrantedFilesystemCurrentV1(value: unknown, mediaDatabasePath: string) {
	const role = typeof value === 'object' && value !== null ? ROLES.get(value) : undefined;
	if (!role) throw new TypeError('A genuine native granted-filesystem owner is required.'); role.current();
	if (typeof mediaDatabasePath !== 'string' || canonical(mediaDatabasePath) !== role.namespace) throw new TypeError('Native filesystem owner belongs to another media namespace.');
	return Object.freeze({ openRoot: role.openRoot, assertCurrent: role.current });
}
/** Main-private read-only role. Trusted composition supplies the one authenticated
 * process launcher; a path, digest, directory observation or ID grants no Photo authority. */
export class LightscaperNativePhotoGrantedFilesystemCurrentV1 {
	#namespace: Namespace; #process?: NativeFilesystemProcessCurrentV1;
	#accepting = true; #close?: Promise<void>; #opening: Promise<void>; #opened!: () => void;
	#ids = new Set<string>(); #jobs = new Set<Promise<unknown>>(); #refs = { root: new Set<Ref>(), file: new Set<Ref>(), scan: new Set<Ref>() };
	#held = new Set<Readonly<{ release(): void }>>(); #faults: unknown[] = []; #unproved = false; #detach: () => void = () => {};
	private constructor(path: string) {
		this.#namespace = register(path); this.#opening = new Promise<void>(resolve => { this.#opened = resolve; });
		const original = this.openRoot;
		ROLES.set(this, Object.freeze({ namespace: canonical(path), current: () => { this.#current(); },
			openRoot: (path: NativePath, expected: NativeFileIdentity | null, options?: Options) => Reflect.apply(original, this, [path, expected, options]) as Promise<NativeRoot> }));
	}
	static async open(options: Readonly<{ start(): ChildProcessWithoutNullStreams; mediaDatabasePath: string; signal?: AbortSignal }>): Promise<LightscaperNativePhotoGrantedFilesystemCurrentV1> {
		const row = ownRecord(options, ['start', 'mediaDatabasePath', 'signal'], ['start', 'mediaDatabasePath']);
		const signal = captureNativeFilesystemSignal(row.signal); checkNativeFilesystemSignal(signal);
		if (typeof row.start !== 'function' || typeof row.mediaDatabasePath !== 'string') throw new TypeError('Native filesystem requires trusted start and actual media namespace.');
		const start = row.start, role = new LightscaperNativePhotoGrantedFilesystemCurrentV1(row.mediaDatabasePath);
		try {
			role.#detach = linkNativeFilesystemSignal(signal, () => { role.stop(); void role.close().catch(() => {}); });
			role.#current(); checkNativeFilesystemSignal(signal);
			role.#process = new NativeFilesystemProcessCurrentV1(() => Reflect.apply(start, undefined, []) as ChildProcessWithoutNullStreams,
				error => { role.#quarantine(error); });
			role.#current(); await role.#process.initialize(); checkNativeFilesystemSignal(signal); role.#current(); role.#opened(); return role;
		} catch (error) {
			let primary = error; try { checkNativeFilesystemSignal(signal); } catch (reason) { primary = reason; }
			role.#opened(); try { await role.close(); } catch (cleanup) { const failure = new AggregateError([primary, cleanup], 'Native filesystem open and retirement failed.'); if (role.#unproved) RETIREMENT_FAILURES.add(failure); throw failure; } throw primary;
		}
	}
	#current(ref?: Ref): void {
		this.#namespace.assertCurrent(); this.#process?.assertCurrent(); if (!this.#accepting || (ref && !ref.accepting)) throw new Error('Native granted filesystem owner is stopped.');
	}
	#quarantine(error: unknown): void {
		this.#unproved = true; this.#accepting = false;
		if (typeof error === 'object' && error !== null) RETIREMENT_FAILURES.add(error);
		if (!this.#faults.some(value => Object.is(value, error))) this.#faults.push(error);
		QUARANTINE.add(this); this.#namespace.quarantine(this);
	}
	#allocate(kind: Kind): Ref {
		this.#current(); const maximum = kind === 'root' ? 64 : kind === 'file' ? 4094 : 4;
		if (this.#refs[kind].size >= maximum) throw new RangeError('Native filesystem handle capacity is busy.');
		let id: Buffer; do { id = randomBytes(32); } while (id.every(byte => byte === 0) || this.#ids.has(id.toString('hex'))); this.#ids.add(id.toString('hex'));
		const ref: Ref = { id, kind, accepting: true, native: false, pending: new Set() }; this.#refs[kind].add(ref); return ref;
	}
	#drop(ref: Ref): void { if (!this.#unproved) { ref.accepting = false; this.#ids.delete(ref.id.toString('hex')); this.#refs[ref.kind].delete(ref); } }
	#request(opcode: number, body: Uint8Array, maximum: number, cleanup = false): Promise<Uint8Array> {
		if (!this.#process) return Promise.reject(new Error('Native filesystem process is not initialized.'));
		return this.#process.request(opcode, body, maximum, cleanup);
	}
	#run<Captured, Result>(refs: readonly Ref[], options: unknown, capture: () => Captured,
		execute: (captured: Captured) => Promise<Result>, opening?: Ref, serial = false): Promise<Result> {
		let resolve!: (value: Result) => void, reject!: (reason: unknown) => void;
		const task = new Promise<Result>((yes, no) => { resolve = yes; reject = no; });
		void (async () => {
			let hold: Readonly<{ release(): void }> | undefined, signal: AbortSignal | undefined, detach: () => void = () => {};
			let failed = false, primary: unknown, result: Result | undefined;
			try {
				this.#current(); for (const ref of refs) this.#current(ref);
				if (serial && refs.some(ref => ref.pending.size !== 0)) throw new RangeError('Native file or scan already owns a pending pull.');
				hold = this.#namespace.read(); this.#held.add(hold); this.#jobs.add(task); for (const ref of refs) ref.pending.add(task); if (opening) opening.pending.add(task);
				signal = captureNativeFilesystemOptions(options); detach = linkNativeFilesystemSignal(signal, () => { this.stop(); void this.close().catch(() => {}); });
				const captured = capture(); checkNativeFilesystemSignal(signal); this.#current(); for (const ref of refs) this.#current(ref);
				result = await execute(captured); checkNativeFilesystemSignal(signal); this.#current(); for (const ref of refs) this.#current(ref);
			} catch (error) {
				failed = true; primary = error; try { checkNativeFilesystemSignal(signal); } catch (reason) { primary = reason; }
				if (opening) {
					try { if (opening.native) await this.#closeNative(opening); this.#drop(opening); }
					catch (cleanup) { primary = new AggregateError([primary, cleanup], 'Native filesystem work and created-owner retirement failed.'); if (this.#unproved) RETIREMENT_FAILURES.add(primary as object); }
				}
			} finally {
				try { detach(); } catch (cleanup) { failed = true; primary = new AggregateError([primary, cleanup], 'Native filesystem signal retirement failed.'); this.#faults.push(cleanup); }
				if (!this.#unproved && hold) { hold.release(); this.#held.delete(hold); }
				this.#jobs.delete(task); for (const ref of refs) ref.pending.delete(task); opening?.pending.delete(task);
			}
			if (failed) reject(primary); else resolve(result as Result);
		})(); return task;
	}

	openRoot(path: NativePath, expected: NativeFileIdentity | null, options?: Options): Promise<NativeRoot> {
		let ref: Ref; try { ref = this.#allocate('root'); } catch (error) { return Promise.reject(error); }
		return this.#run([], options, () => ({ path: captureNativePath(path, true), expected: expected === null ? null : captureIdentity(expected) }), async input => {
			const body = new NativeWriter().raw(ref.id).path(input.path).number(input.expected ? 1 : 0, 1); if (input.expected) body.identity(input.expected);
			const reply = new NativeReader(await this.#request(OP.rootOpen, body.finish(), 516)); ref.native = true; const identity = reply.identity(); reply.end();
			return Object.freeze({ identity, openFile: (components: readonly NativePath[], opts?: Options) => this.#openFile(ref, components, opts),
				openScan: (components: readonly NativePath[], opts?: Options) => this.#openScan(ref, components, opts), close: () => this.#closeRef(ref) });
		}, ref);
	}
	#openFile(parent: Ref, components: readonly NativePath[], options?: Options): Promise<NativeFile> {
		let ref: Ref; try { this.#current(parent); ref = this.#allocate('file'); } catch (error) { return Promise.reject(error); }
		return this.#run([parent], options, () => captureComponents(components, false), async names => {
			const reply = new NativeReader(await this.#request(OP.fileOpen, new NativeWriter().raw(ref.id).raw(parent.id).components(names).finish(), 524));
			ref.native = true; const byteLength = reply.number(8), identity = reply.identity(); reply.end();
			return Object.freeze({ identity, byteLength, read: (offset: number, length: number, opts?: Options) => this.#run([ref], opts, () => {
				if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > 1048576 || offset > byteLength || length > byteLength - offset) throw new RangeError('Native file pull exceeds its fixed range.');
				return { offset, length };
			}, async range => { const bytes = await this.#request(OP.read, new NativeWriter().raw(ref.id).number(range.offset, 8).number(range.length, 4).finish(), range.length);
				if (bytes.byteLength !== range.length) throw new Error('Native file pull returned a short body.'); return bytes;
			}, undefined, true), close: () => this.#closeRef(ref) });
		}, ref);
	}
	#openScan(parent: Ref, components: readonly NativePath[], options?: Options): Promise<NativeScan> {
		let ref: Ref; try { this.#current(parent); ref = this.#allocate('scan'); } catch (error) { return Promise.reject(error); }
		return this.#run([parent], options, () => captureComponents(components, true), async names => {
			const reply = await this.#request(OP.scanOpen, new NativeWriter().raw(ref.id).raw(parent.id).components(names).finish(), 0); ref.native = true;
			if (reply.byteLength) throw new Error('Native scan-open returned unexpected fields.');
			return Object.freeze({ next: (opts?: Options) => this.#run([ref], opts, () => {}, async () => {
				if (ref.done) return Object.freeze({ entries: Object.freeze([]), done: true });
				const page = readNativePage(await this.#request(OP.next, ref.id, 65536)); ref.done = page.done; return page;
			}, undefined, true), close: () => this.#closeRef(ref) });
		}, ref);
	}
	async #closeNative(ref: Ref): Promise<void> {
		if (!this.#process || this.#process.isRetired) return;
		// Whole-role retirement already owns every native ref. Join its actual
		// process directly; another CLOSE after SHUTDOWN would race pipe exit.
		if (!this.#accepting) { await this.#process.close(); return; }
		const opcode = ref.kind === 'root' ? OP.rootClose : ref.kind === 'file' ? OP.fileClose : OP.scanClose;
		try { const reply = await this.#request(opcode, ref.id, 0, true); if (reply.byteLength) throw new Error('Native close returned unexpected fields.'); }
		catch (error) { if (nativeRetirementIsUnproved(error)) this.#quarantine(error); if (!this.#process.isRetired || this.#unproved) throw error; }
	}
	#closeRef(ref: Ref): Promise<void> {
		if (ref.close) return ref.close; let resolve!: () => void, reject!: (reason: unknown) => void;
		ref.close = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); ref.accepting = false; this.#jobs.add(ref.close);
		void (async () => { await Promise.allSettled([...ref.pending]); if (ref.native) await this.#closeNative(ref); this.#drop(ref); })().then(() => { this.#jobs.delete(ref.close!); resolve(); }, error => { this.#faults.push(error); this.#jobs.delete(ref.close!); reject(error); });
		return ref.close;
	}
	stop(): void { this.#accepting = false; }
	close(): Promise<void> {
		if (this.#close) return this.#close; let resolve!: () => void, reject!: (reason: unknown) => void;
		this.#close = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); this.stop();
		void (async () => {
			// Quiesce an already-created child before waiting for INIT/open settlement.
			const early = this.#process?.close(); if (early) void early.catch(() => {});
			await this.#opening; const failures: unknown[] = [];
			try { await this.#process?.close(); } catch (error) { failures.push(error); }
			await Promise.allSettled([...this.#jobs]);
			try { this.#detach(); } catch (error) { failures.push(error); }
			for (const error of this.#faults) if (!failures.some(value => Object.is(value, error))) failures.push(error);
			if (!this.#unproved) { this.#namespace.retire(); this.#ids.clear(); for (const refs of Object.values(this.#refs)) refs.clear(); }
			if (failures.length === 1) throw failures[0]; if (failures.length) {
				const failure = new AggregateError(failures, 'Native filesystem retirement failed.'); if (this.#unproved) RETIREMENT_FAILURES.add(failure); throw failure;
			}
		})().then(resolve, reject); return this.#close;
	}
}
