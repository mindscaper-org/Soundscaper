/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { OpfsSyncWorkerRuntime } from '../src/common/editor/storage/opfs-sync-worker-runtime.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const SHARED = 'original.blob', OTHER = 'mask.blob', WRITTEN = 'new.blob';
const ORIGINAL = Uint8Array.of(8, 3, 7, 2), MASK = Uint8Array.of(1, 0, 1);
const OPTIONS = { concurrency: false, timeout: 5_000 };
type Outcome = { ok: true; value: Record<string, unknown> } | { ok: false; error: unknown };
type Work = Promise<Outcome>;
interface FileState { bytes: Uint8Array<ArrayBuffer>; accesses: number; closes: number; live: number; snapshots: number }

/** Controlled Web Locks port: callbacks own one name until their actual promise settles. */
class SharedReadLocks {
	readonly #tails = new Map<string, Promise<void>>();
	async request<Result>(name: string, options: Readonly<{ mode?: string; signal?: AbortSignal }>, consume: () => Promise<Result>): Promise<Result> {
		assert.equal(options.mode, 'exclusive');
		const previous = this.#tails.get(name) ?? Promise.resolve(), terminal = deferred<void>();
		const tail = previous.then(() => terminal.promise); this.#tails.set(name, tail);
		void tail.then(() => { if (this.#tails.get(name) === tail) this.#tails.delete(name); });
		const signal = options.signal;
		let onAbort: (() => void) | undefined;
		try {
			if (signal) {
				if (signal.aborted) throw signal.reason;
				const aborted = new Promise<never>((_resolve, reject) => {
					onAbort = () => { reject(signal.reason); }; signal.addEventListener('abort', onAbort, { once: true });
				});
				await Promise.race([previous, aborted]);
				if (signal.aborted) throw signal.reason;
			} else await previous;
			// Native Web Locks ignores signal abort once the callback has been granted.
			if (onAbort) signal?.removeEventListener('abort', onAbort);
			return await consume();
		} finally {
			if (onAbort) signal?.removeEventListener('abort', onAbort);
			terminal.resolve();
		}
	}
}

/** Two actual runtimes share explicit filesystem/lock ports. The default port
 * models the observed native access/access exclusion, not getFile exclusion. */
class SharedReadFixture {
	readonly locks = new SharedReadLocks();
	// Both runtimes borrow the same origin-wide lock manager.
	readonly options = { supportsSyncAccessHandles: () => true, locks: this.locks };
	readonly left = new OpfsSyncWorkerRuntime(this.options);
	readonly right = new OpfsSyncWorkerRuntime(this.options);
	readonly files = new Map<string, FileState>();
	readonly lookups: string[] = [];
	readonly entered = deferred<void>();
	readonly release = deferred<void>();
	readonly #work: Work[] = [];
	readonly #writers: { runtime: OpfsSyncWorkerRuntime; writerId: string }[] = [];
	#held = false;
	constructor() { this.seed(SHARED, ORIGINAL); this.seed(OTHER, MASK); }
	seed(path: string, bytes: Uint8Array): void { this.files.set(path, { bytes: new Uint8Array(bytes), accesses: 0, closes: 0, live: 0, snapshots: 0 }); }
	readonly directory = {
		name: 'controlled-shared-directory',
		getFileHandle: async (path: string, options: Readonly<{ create?: boolean }> = {}) => {
			this.lookups.push(path); if (!this.files.has(path) && options.create) this.seed(path, new Uint8Array());
			const file = this.files.get(path); if (!file) throw new DOMException('Controlled file absent.', 'NotFoundError');
			const unlocked = () => { if (file.live) throw new DOMException('Controlled cross-worker access-handle overlap.', 'NoModificationAllowedError'); };
			return {
				createSyncAccessHandle: async () => {
					unlocked(); file.live++; file.accesses++; let closed = false;
					// Hold one genuinely acquired access before its async acquisition returns.
					if (path === SHARED && !this.#held) { this.#held = true; this.entered.resolve(); await this.release.promise; }
					return {
						getSize: () => file.bytes.byteLength,
						read: (target: ArrayBufferView, at: Readonly<{ at: number }>) => {
							const bytes = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
							bytes.set(file.bytes.subarray(at.at, at.at + bytes.byteLength)); return bytes.byteLength;
						},
						write: (source: ArrayBufferView, at: Readonly<{ at: number }>) => {
							const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength), next = new Uint8Array(Math.max(file.bytes.byteLength, at.at + bytes.byteLength));
							next.set(file.bytes); next.set(bytes, at.at); file.bytes = next; return bytes.byteLength;
						},
						truncate: (size: number) => { const next = new Uint8Array(size); next.set(file.bytes.subarray(0, size)); file.bytes = next; },
						flush: () => {},
						close: () => { assert.equal(closed, false); closed = true; file.live--; file.closes++; },
					};
				},
				getFile: async () => {
					file.snapshots++;
					try {
						return new Blob([file.bytes.slice()]);
					} finally { file.snapshots--; }
				},
			};
		},
		removeEntry: (path: string) => { this.files.delete(path); return Promise.resolve(); },
	};
	async ready(): Promise<void> {
		for (const runtime of [this.left, this.right]) assert.deepEqual(await runtime.handle({ id: 'init', type: 'initialize', directory: this.directory as unknown as FileSystemDirectoryHandle }), { supported: true });
	}
	start(runtime: OpfsSyncWorkerRuntime, request: Record<string, unknown>): Work {
		const work = runtime.handle(request).then(value => {
			if (request.type === 'open-writer' && typeof value.writerId === 'string') this.#writers.push({ runtime, writerId: value.writerId });
			return { ok: true as const, value };
		}, (error: unknown) => ({ ok: false as const, error }));
		this.#work.push(work); return work;
	}
	async close(): Promise<void> {
		this.release.resolve(); await Promise.all(this.#work);
		for (const { runtime, writerId } of this.#writers) await runtime.handle({ id: 'cleanup-writer', type: 'abort-writer', writerId });
		for (const file of this.files.values()) { assert.equal(file.live, 0); assert.equal(file.snapshots, 0); assert.equal(file.accesses, file.closes); }
		assert.deepEqual(this.files.get(SHARED)?.bytes, ORIGINAL); assert.deepEqual(this.files.get(OTHER)?.bytes, MASK);
	}
}

function snapshot(id: string, path = SHARED): Record<string, unknown> { return { id, type: 'snapshot', operationId: 'media-asset-chunk-read', path }; }
function read(id: string, path = SHARED): Record<string, unknown> { return { id, type: 'read', operationId: 'media-asset-chunk-read', path, offset: 0, length: path === SHARED ? ORIGINAL.length : MASK.length }; }
function success(outcome: Outcome): Record<string, unknown> { if (!outcome.ok) throw outcome.error; return outcome.value; }
async function bytes(value: Record<string, unknown>): Promise<number[]> {
	if (value.file instanceof Blob) return [...new Uint8Array(await value.file.arrayBuffer())];
	assert.ok(value.bytes instanceof ArrayBuffer); return [...new Uint8Array(value.bytes)];
}
async function held(f: SharedReadFixture, first: Work): Promise<void> {
	await Promise.race([f.entered.promise, first.then(outcome => { success(outcome); assert.fail('Snapshot settled before its held native acquisition boundary.'); })]);
}
async function pending(work: Work): Promise<void> {
	await settle(2); if (!await remainsPending(work)) { success(await work); assert.fail('Other runtime bypassed the held native read owner.'); }
}
async function completed(work: Work): Promise<Record<string, unknown>> {
	await settle(2); assert.equal(await remainsPending(work), false, 'An independent operation waited behind the held shared path.'); return success(await work);
}

for (const next of ['read', 'snapshot'] as const) test(`Light cross-worker snapshot serializes native acquisition against another runtime's ${next}`, OPTIONS, async t => {
	const f = new SharedReadFixture(); t.after(() => f.close()); await f.ready();
	const first = f.start(f.left, snapshot('left-held')); await held(f, first);
	const second = f.start(f.right, next === 'read' ? read('right-shared') : snapshot('right-shared'));
	await pending(second); assert.deepEqual(f.lookups, [SHARED]);
	assert.deepEqual(await bytes(await completed(f.start(f.right, read('right-other', OTHER)))), [...MASK]);
	const writer = await completed(f.start(f.right, { id: 'open-independent', type: 'open-writer', operationId: 'media-asset-chunk-write', path: WRITTEN }));
	await completed(f.start(f.right, { id: 'write-independent', type: 'write', writerId: writer.writerId, bytes: Uint8Array.of(4, 5).buffer }));
	await completed(f.start(f.right, { id: 'close-independent', type: 'close-writer', writerId: writer.writerId }));
	assert.deepEqual(await bytes(await completed(f.start(f.right, snapshot('read-independent', WRITTEN)))), [4, 5]);
	assert.equal(await remainsPending(first), true); assert.equal(await remainsPending(second), true);
	f.release.resolve(); assert.deepEqual(await bytes(success(await first)), [...ORIGINAL]); assert.deepEqual(await bytes(success(await second)), [...ORIGINAL]);
});

test('Light cross-worker queued cancellation enters no filesystem and leaves later reads usable', OPTIONS, async t => {
	const f = new SharedReadFixture(); t.after(() => f.close()); await f.ready();
	const first = f.start(f.left, snapshot('left-held')); await held(f, first);
	const second = f.start(f.right, read('right-cancelled')); await pending(second);
	assert.deepEqual(await completed(f.start(f.right, { id: 'right-cancelled', type: 'cancel' })), { cancelled: true });
	assert.deepEqual(f.lookups, [SHARED]); assert.equal(await remainsPending(first), true);
	assert.deepEqual(await bytes(await completed(f.start(f.right, read('right-independent', OTHER)))), [...MASK]);
	f.release.resolve(); assert.deepEqual(await bytes(success(await first)), [...ORIGINAL]);
	const cancelled = await second; assert.equal(cancelled.ok, false);
	if (!cancelled.ok) { assert.ok(cancelled.error instanceof Error); assert.equal(cancelled.error.name, 'AbortError'); }
	assert.deepEqual(f.lookups, [SHARED, OTHER]);
	assert.deepEqual(await bytes(success(await f.start(f.right, read('right-after-cancel')))), [...ORIGINAL]);
});

test('Light denied origin lock preserves its failure without entering the filesystem or retrying unlocked', OPTIONS, async t => {
	const f = new SharedReadFixture(); t.after(() => f.close()); await f.ready();
	const request = f.locks.request, reason = new DOMException('Read lock denied.', 'SecurityError');
	f.locks.request = () => Promise.reject(reason);
	const denied = await f.start(f.right, read('denied', OTHER));
	assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error, reason);
	assert.deepEqual(f.lookups, []);
	f.locks.request = request;
	assert.deepEqual(await bytes(success(await f.start(f.right, read('after-denial', OTHER)))), [...MASK]);
	assert.deepEqual(f.lookups, [OTHER]);
});
