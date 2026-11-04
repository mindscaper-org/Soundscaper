/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { OpfsSyncWorkerRuntime } from '../src/common/editor/storage/opfs-sync-worker-runtime.ts';

function fixture(failFirst = false) {
	let release = (): void => {};
	let entered = (): void => {};
	const held = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	const locked = new Set<string>();
	const attempts: string[] = [];
	const failure = new Error('first native handle failed');
	const directory = {
		async getFileHandle(path: string) {
			return {
				async createSyncAccessHandle() {
					attempts.push(path);
					if (locked.has(path)) throw new DOMException('Exclusive handle is already open', 'NoModificationAllowedError');
					locked.add(path);
					if (attempts.length === 1) {
						entered();
						await held;
						if (failFirst) { locked.delete(path); throw failure; }
					}
					return {
						getSize: () => 1,
						read: (bytes: Uint8Array) => { bytes[0] = 42; return bytes.length; },
						close: () => { locked.delete(path); },
					};
				},
				async getFile() { return new Blob([Uint8Array.of(42)]); },
			};
		},
		async removeEntry() {},
	} as unknown as FileSystemDirectoryHandle;
	const runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => true });
	return { runtime, directory, started, release: () => release(), attempts, failure };
}

function read(id: string, path = 'source.scpcm') {
	return { id, type: 'read', operationId: 'canonical-pcm-chunk-read', path, offset: 0, length: 1 };
}

test('OPFS reads and snapshots queue per file while other files remain independent', async () => {
	const f = fixture();
	await f.runtime.handle({ id: 'init', type: 'initialize', directory: f.directory });
	const first = f.runtime.handle(read('first'));
	await f.started;
	const second = f.runtime.handle(read('second'));
	const snapshot = f.runtime.handle({ id: 'snapshot', type: 'snapshot', operationId: 'media-asset-chunk-read', path: 'source.scpcm' });
	const other = f.runtime.handle(read('other', 'other.scpcm'));
	const settled = Promise.allSettled([first, second, snapshot, other]);
	const independent = await other;
	f.release();
	const results = await settled;
	assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
	assert.deepEqual(f.attempts, ['source.scpcm', 'other.scpcm', 'source.scpcm', 'source.scpcm']);
	assert.deepEqual(new Uint8Array(independent.bytes as ArrayBuffer), Uint8Array.of(42));
	assert.equal((await snapshot).file instanceof Blob, true);
});

test('cancelling a queued OPFS read opens no handle and does not block the next reader', async () => {
	const f = fixture();
	await f.runtime.handle({ id: 'init', type: 'initialize', directory: f.directory });
	const first = f.runtime.handle(read('first'));
	await f.started;
	const cancelled = f.runtime.handle(read('withdrawn'));
	const last = f.runtime.handle(read('last'));
	const settled = Promise.allSettled([first, cancelled, last]);
	await f.runtime.handle({ id: 'withdrawn', type: 'cancel' });
	f.release();
	const results = await settled;
	assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
	assert.equal(results[1]?.status === 'rejected' && (results[1].reason as Error).name, 'AbortError');
	assert.deepEqual(f.attempts, ['source.scpcm', 'source.scpcm']);
});

test('a failed OPFS read releases the next read of the same file', async () => {
	const f = fixture(true);
	await f.runtime.handle({ id: 'init', type: 'initialize', directory: f.directory });
	const first = f.runtime.handle(read('first'));
	await f.started;
	const second = f.runtime.handle(read('second'));
	const settled = Promise.allSettled([first, second]);
	f.release();
	const results = await settled;
	assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled']);
	assert.equal(results[0]?.status === 'rejected' && results[0].reason, f.failure);
	assert.deepEqual(f.attempts, ['source.scpcm', 'source.scpcm']);
});
