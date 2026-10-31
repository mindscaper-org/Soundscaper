/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createExactPreviewRenderCoordinator } from '../src/common/editor/controller/clip-video/exact-preview-render-coordinator.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';
import { SourceReadRepository } from '../src/common/editor/storage/source-read-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { crc32, parsePcmContainerIndex, PCM_ENCODING_RAW_F32LE, PcmContainerWriter, readPcmContainerPayload } from '../src/common/editor/wavpack/index.js';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(accept => { resolve = accept; });
	return { promise, resolve };
}

async function outcome(promise: Promise<unknown>) {
	return promise.then(value => ({ rejected: false as const, value }), (error: unknown) => ({ rejected: true as const, error }));
}

async function exactRejection(promise: Promise<unknown>, expected: unknown): Promise<void> {
	const result = await outcome(promise);
	assert.equal(result.rejected, true);
	if (result.rejected) assert.equal(Object.is(result.error, expected), true);
}

function cancellation(kind: 'error' | 'object' | 'opaque' | 'null' | 'nan' | 'native') {
	let traps = 0;
	const opaque = new Proxy({}, { get() { traps += 1; throw new Error('Opaque get.'); },
		getPrototypeOf() { traps += 1; throw new Error('Opaque prototype.'); },
		has() { traps += 1; throw new Error('Opaque has.'); } });
	const value: unknown = kind === 'error' ? new Error('Only this read stopped.')
		: kind === 'object' ? Object.freeze({ stop: 'only this read' }) : kind === 'opaque' ? opaque
			: kind === 'null' ? null : kind === 'nan' ? NaN : new DOMException('Only this read stopped.', 'AbortError');
	return { value, assertUnreflected() { assert.equal(traps, 0); } };
}

class AcceptedReadSlice extends Blob {
	constructor(part: Blob, readonly afterRead: () => Promise<void>) { super([part]); }
	override async arrayBuffer(): Promise<ArrayBuffer> {
		const bytes = await super.arrayBuffer();
		await this.afterRead();
		return bytes;
	}
}

class ContainerFile extends File {
	readonly started = deferred();
	readonly release = deferred();
	armed = false;
	held = false;
	payloadReads = 0;
	sliceCalls = 0;
	failure: Readonly<{ value: unknown }> | undefined;
	constructor(parts: BlobPart[]) { super(parts, 'source.scpcm'); }
	override slice(start = 0, end = this.size, type = ''): Blob {
		this.sliceCalls += 1;
		const actual = super.slice(start, end, type);
		if (start !== 32 || end !== 48) return actual;
		return new AcceptedReadSlice(actual, async () => {
			this.payloadReads += 1;
			if (!this.armed) return;
			this.armed = false; this.held = true; this.started.resolve();
			await this.release.promise;
			if (this.failure) throw this.failure.value;
		});
	}
}

/** Structural directory model only; never native OPFS admission or custody proof. */
class ReadFileHandle implements FileSystemFileHandle {
	readonly kind = 'file';
	readonly name = 'source.scpcm';
	constructor(readonly file: File) {}
	async getFile(): Promise<File> { return this.file; }
	async createWritable(): Promise<FileSystemWritableFileStream> { throw new Error('Read-only test model.'); }
	async isSameEntry(other: FileSystemHandle): Promise<boolean> { return other === this; }
}
class ReadDirectory implements FileSystemDirectoryHandle {
	readonly kind = 'directory';
	readonly name = 'audio-editor-sources';
	readonly handle: ReadFileHandle;
	constructor(file: File) { this.handle = new ReadFileHandle(file); }
	async getDirectoryHandle(): Promise<FileSystemDirectoryHandle> { return this; }
	async getFileHandle(name: string): Promise<FileSystemFileHandle> {
		assert.equal(name, this.handle.name); return this.handle;
	}
	async removeEntry(): Promise<void> { throw new Error('Read-only test model.'); }
	async resolve(): Promise<string[] | null> { return null; }
	async isSameEntry(other: FileSystemHandle): Promise<boolean> { return other === this; }
	async *entries(): AsyncGenerator<[string, FileSystemDirectoryHandle | FileSystemFileHandle], undefined, unknown> { yield [this.handle.name, this.handle]; }
	async *keys(): AsyncGenerator<string, undefined, unknown> { yield this.handle.name; }
	async *values(): AsyncGenerator<FileSystemDirectoryHandle | FileSystemFileHandle, undefined, unknown> { yield this.handle; }
	[Symbol.asyncIterator]() { return this.entries(); }
}

async function container(): Promise<ContainerFile> {
	const parts: BlobPart[] = [];
	const payload = Float32Array.of(0.25, -0.5, 0.75, -0.125).buffer;
	const writer = new PcmContainerWriter({ async write(input) {
		const bytes = input instanceof ArrayBuffer ? new Uint8Array(input)
			: new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
		parts.push(bytes.slice().buffer);
	}, async close() {} }, { channelCount: 1, sampleRate: 48_000, chunkFrames: 4 });
	await writer.write({ frames: 4, encoding: PCM_ENCODING_RAW_F32LE, payload, pcmCrc32: crc32(payload) });
	await writer.close();
	return new ContainerFile(parts);
}

async function fixture(t: TestContext) {
	const file = await container();
	const opfs = new OpfsRepository({ preferOpfs: true, opfsRoot: new ReadDirectory(file), syncWorkerClient: null });
	const pcm = new PcmRepository();
	const records = new SourceRecordRepository({ memory: getMemoryDatabase(`container-cancel-${crypto.randomUUID()}`), database: async () => null });
	await records.putMetadata({ id: 'audio', sourceToken: 'token', storage: 'opfs-pcm-v1', path: file.name,
		frameCount: 4, channelCount: 1, chunkFrames: 4, chunkCount: 1, sampleRate: 48_000 });
	const source = new SourceReadRepository({ records, pcm, opfs });
	let expired = false;
	const deadline = setTimeout(() => { expired = true; file.started.resolve(); file.release.resolve(); }, 8_000);
	t.after(async () => { clearTimeout(deadline); file.release.resolve(); await source.releaseSessions(); opfs.close(); pcm.closeOwnedCodec(); });
	return { file, source, assertHeld() { assert.equal(file.held, true); assert.equal(expired, false); } };
}

for (const kind of ['error', 'object', 'opaque', 'null', 'nan', 'native'] as const) {
	test(`PCM container pre-abort preserves exact ${kind} reason without pulling bytes`, { timeout: 10_000 }, async () => {
		const file = await container(), index = await parsePcmContainerIndex(file), stop = new AbortController();
		const entry = index.entries[0]; assert.ok(entry);
		const reason = cancellation(kind), before = file.sliceCalls; stop.abort(reason.value);
		await exactRejection(parsePcmContainerIndex(file, { signal: stop.signal }), reason.value);
		await exactRejection(readPcmContainerPayload(file, entry, { signal: stop.signal }), reason.value);
		assert.equal(file.payloadReads, 0); assert.equal(file.sliceCalls, before); reason.assertUnreflected();
	});

	test(`actual OPFS container ${kind} cancellation joins the accepted read and leaves the next PCM decode healthy`, { timeout: 10_000 }, async t => {
		const f = await fixture(t), stop = new AbortController(), reason = cancellation(kind);
		f.file.armed = true;
		const read = f.source.chunk('audio', 0, { signal: stop.signal });
		const result = outcome(read); let settled = false;
		const joined = result.then(value => { settled = true; return value; });
		try {
			await f.file.started.promise; f.assertHeld(); stop.abort(reason.value);
			await Promise.resolve(); assert.equal(settled, false, 'The accepted real Blob read must finish before rejection.');
			f.file.release.resolve(); await exactRejection(read, reason.value); await joined;
			assert.deepEqual([...(await f.source.chunk('audio', 0)).channels[0]!], [0.25, -0.5, 0.75, -0.125]);
			assert.equal(f.file.payloadReads, 2); f.assertHeld(); reason.assertUnreflected();
		} finally { f.file.release.resolve(); await joined; }
	});
}

test('a genuine container source supersession joins and permits the next exact coordinator frame', { timeout: 10_000 }, async t => {
	const f = await fixture(t); f.file.armed = true;
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('No automatic replacement.'), { mode: 'continuous' });
	const published: number[] = [], failures: unknown[] = [];
	let signal: AbortSignal | undefined, joined = false;
	const running = coordinator.run({ render: stop => { signal = stop; return f.source.chunk('audio', 0, { signal: stop }); },
		isCurrent: () => true, publish: () => assert.fail('Cancelled frame published.'), onError: error => { failures.push(error); } });
	let replacement: Promise<void> | undefined;
	try {
		await f.file.started.promise; f.assertHeld(); assert.ok(signal);
		replacement = coordinator.supersede().then(() => { joined = true; });
		assert.equal(signal.aborted, true); await Promise.resolve(); assert.equal(joined, false);
		f.file.release.resolve(); await Promise.all([running, replacement]);
		await coordinator.run({ render: stop => f.source.chunk('audio', 0, { signal: stop }), isCurrent: () => true,
			publish: frame => { assert.deepEqual([...frame.channels[0]!], [0.25, -0.5, 0.75, -0.125]); published.push(1); },
			onError: error => { failures.push(error); } });
		assert.deepEqual(published, [1]); assert.deepEqual(failures, []); f.assertHeld();
	} finally { f.file.release.resolve(); await Promise.allSettled([running, replacement, coordinator.retire()]); }
});

test('an unrelated actual container payload read failure stays exact and fences coordinator replacement', { timeout: 10_000 }, async t => {
	const f = await fixture(t), failure = new Error('Actual payload read failed.');
	f.file.armed = true; f.file.failure = { value: failure };
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('No failed replacement.'), { mode: 'continuous' });
	const running = coordinator.run({ render: signal => f.source.chunk('audio', 0, { signal }), isCurrent: () => true,
		publish: () => assert.fail('No frame.'), onError: () => assert.fail('Superseded failure cannot publish.') });
	let result: ReturnType<typeof outcome> | undefined;
	try {
		await f.file.started.promise; f.assertHeld();
		const replacing = coordinator.supersede(); result = outcome(replacing);
		f.file.release.resolve(); await running; await exactRejection(replacing, failure); await result;
		await exactRejection(coordinator.run({ render: () => assert.fail('No replacement admission.'), isCurrent: () => true,
			publish: () => assert.fail('No frame.'), onError: () => assert.fail('No callback.') }), failure);
		f.assertHeld();
	} finally { f.file.release.resolve(); await Promise.allSettled([running, result, coordinator.retire()]); }
});

test('PCM container keeps its AbortError fallback when a signal exposes no reason', { timeout: 10_000 }, async () => {
	const file = await container(), stop = new AbortController(); stop.abort();
	let reads = 0;
	Object.defineProperty(stop.signal, 'reason', { get() { reads += 1; return undefined; } });
	const result = await outcome(parsePcmContainerIndex(file, { signal: stop.signal }));
	assert.equal(result.rejected, true);
	if (result.rejected) {
		assert.ok(result.error instanceof Error); assert.equal(result.error.name, 'AbortError');
		assert.equal(result.error.message, 'PCM container work was cancelled.');
	}
	assert.equal(reads, 1); assert.equal(file.payloadReads, 0);
});
