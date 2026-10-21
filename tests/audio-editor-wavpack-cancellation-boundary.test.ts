/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createExactPreviewRenderCoordinator } from '../src/common/editor/controller/clip-video/exact-preview-render-coordinator.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';
import { SourceReadRepository } from '../src/common/editor/storage/source-read-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { WavPackCodecClient } from '../src/common/editor/wavpack/client.js';
import { crc32, PCM_ENCODING_RAW_F32LE } from '../src/common/editor/wavpack/pcm.js';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(accept => { resolve = accept; });
	return { promise, resolve };
}
function outcome(promise: Promise<unknown>) {
	return promise.then(value => ({ rejected: false as const, value }), (error: unknown) => ({ rejected: true as const, error }));
}
async function exactRejection(promise: Promise<unknown>, expected: unknown): Promise<void> {
	const result = await outcome(promise); assert.equal(result.rejected, true);
	if (result.rejected) assert.equal(Object.is(result.error, expected), true);
}
function opaqueReason() {
	let traps = 0;
	const reason = new Proxy({}, { get() { traps += 1; throw new Error('Opaque get.'); },
		getPrototypeOf() { traps += 1; throw new Error('Opaque prototype.'); },
		has() { traps += 1; throw new Error('Opaque has.'); } });
	return { reason, assertUnreflected() { assert.equal(traps, 0); } };
}
const raw = Float32Array.from({ length: 2_048 }, (_, index) => (index % 17 - 8) / 16);
const geometry = { frames: raw.length, channelCount: 1, sampleRate: 48_000 };

test('actual WavPack checksum worker cancellation stays local at the client boundary', { timeout: 20_000 }, async t => {
	let receive: ((event: Readonly<{ data: unknown }>) => void) | undefined;
	const owners = new Map<string, Transport>();
	const work = new Set<Promise<void>>();
	const workers: Transport[] = [], clients: WavPackCodecClient[] = [];
	const slots = new Map<WavPackCodecClient, { ready: ReturnType<typeof deferred>; worker?: Transport }>();
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
	class Transport extends EventTarget {
		readonly held = deferred();
		hold = false;
		retired = 0;
		pending: unknown[] = [];
		postMessage(value: unknown, transfer: ArrayBuffer[]) {
			assert.ok(receive); assert.ok(value && typeof value === 'object' && 'id' in value && typeof value.id === 'string');
			const id = value.id, done = deferred(); owners.set(id, this); work.add(done.promise);
			void done.promise.then(() => { work.delete(done.promise); });
			this.completions.set(id, done.resolve);
			receive({ data: structuredClone(value, { transfer }) });
		}
		readonly completions = new Map<string, () => void>();
		accept(id: string, response: unknown) {
			this.completions.get(id)?.(); this.completions.delete(id); owners.delete(id);
			if (this.hold) { this.hold = false; this.pending.push(response); this.held.resolve(); }
			else this.dispatchEvent(new MessageEvent('message', { data: response }));
		}
		release() { for (const data of this.pending.splice(0)) this.dispatchEvent(new MessageEvent('message', { data })); }
		terminate() { this.retired += 1; }
	}
	// Adapter only: the real worker.js listener computes and transfers every PCM result.
	// Retirement counts prove client policy; this in-process transport is not a native thread witness.
	Reflect.set(globalThis, 'self', {
		addEventListener(type: string, listener: typeof receive) { assert.equal(type, 'message'); receive = listener; },
		postMessage(value: unknown, transfer: ArrayBuffer[] = []) {
			assert.ok(value && typeof value === 'object' && 'id' in value && typeof value.id === 'string');
			const worker = owners.get(value.id); assert.ok(worker);
			worker.accept(value.id, structuredClone(value, { transfer }));
		},
	});
	t.after(async () => {
		for (const client of clients) client.close();
		for (const worker of workers) worker.release();
		await Promise.all([...work]);
		if (previous) Object.defineProperty(globalThis, 'self', previous); else Reflect.deleteProperty(globalThis, 'self');
	});
	await import('../src/common/editor/wavpack/worker.js');
	function client(hold = false) {
		const slot: { ready: ReturnType<typeof deferred>; worker?: Transport } = { ready: deferred() };
		const codec = new WavPackCodecClient({ timeoutMs: 4_000, workerFactory: () => {
			const transport = new Transport(); transport.hold = hold; hold = false; workers.push(transport); slot.worker = transport; slot.ready.resolve(); return transport;
		} }); clients.push(codec); slots.set(codec, slot); return codec;
	}
	async function source(context: TestContext, codec: WavPackCodecClient) {
		const records = new SourceRecordRepository({ memory: getMemoryDatabase(`worker-boundary-${crypto.randomUUID()}`), database: async () => null });
		await records.putMetadata({ id: 'audio', sourceToken: 'token', storage: 'indexeddb-chunks',
			frameCount: raw.length, channelCount: 1, chunkFrames: raw.length, chunkCount: 1, sampleRate: 48_000 });
		await records.writeChunk({ key: 'token:0000000000', sourceToken: 'token', index: 0, frames: raw.length,
			encoding: PCM_ENCODING_RAW_F32LE, payload: raw.buffer.slice(0), pcmCrc32: crc32(raw.buffer) });
		const pcm = new PcmRepository({ codec }), opfs = new OpfsRepository({ preferOpfs: false });
		const reader = new SourceReadRepository({ records, pcm, opfs });
		context.after(async () => { codec.close(); await reader.releaseSessions(); opfs.close(); });
		return reader;
	}
	async function held(context: TestContext, codec: WavPackCodecClient) {
		const slot = slots.get(codec); assert.ok(slot);
		let expired = false;
		const deadline = setTimeout(() => { expired = true; slot.ready.resolve(); slot.worker?.held.resolve(); slot.worker?.release(); }, 5_000);
		context.after(() => { clearTimeout(deadline); slot.worker?.release(); });
		await slot.ready.promise; const worker = slot.worker; assert.ok(worker);
		await worker.held.promise; assert.equal(expired, false); assert.equal(worker.pending.length, 1);
		return worker;
	}

	await t.test('pre-aborted opaque client request preserves identity without creating a worker', async () => {
		const codec = client(), stop = new AbortController(), opaque = opaqueReason(), count = workers.length;
		stop.abort(opaque.reason);
		await exactRejection(codec.checksum(raw.buffer, { ...geometry, signal: stop.signal }), opaque.reason);
		assert.equal(workers.length, count); opaque.assertUnreflected(); codec.close();
	});

	await t.test('native coordinator supersession retires a completed real checksum response and admits the next PCM frame', async context => {
		const codec = client(true), reader = await source(context, codec);
		const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('No automatic replacement.'), { mode: 'continuous' });
		const failures: unknown[] = []; let published = 0;
		const running = coordinator.run({ render: signal => reader.chunk('audio', 0, { signal }), isCurrent: () => true,
			publish: () => assert.fail('Cancelled frame published.'), onError: error => { failures.push(error); } });
		let replacing: Promise<void> | undefined;
		try {
			const worker = await held(context, codec); replacing = coordinator.supersede();
			const observed = outcome(replacing); worker.release(); await running;
			const joined = await observed; if (joined.rejected) throw joined.error;
			assert.equal(worker.retired, 1, 'The actual active client worker must retire.');
			const count = workers.length;
			await coordinator.run({ render: signal => reader.chunk('audio', 0, { signal }), isCurrent: () => true,
				publish: frame => { assert.deepEqual([...frame.channels[0]!], [...raw]); published += 1; }, onError: error => { failures.push(error); } });
			assert.equal(published, 1); assert.deepEqual(failures, []); assert.equal(workers.length, count + 1);
		} finally { for (const worker of workers) worker.release(); await Promise.allSettled([running, replacing, coordinator.retire()]); }
	});

	await t.test('opaque in-flight source checksum cancellation preserves identity and keeps the next real checksum healthy', async context => {
		const codec = client(true), reader = await source(context, codec), stop = new AbortController(), opaque = opaqueReason();
		const reading = reader.chunk('audio', 0, { signal: stop.signal }), observed = outcome(reading);
		try {
			const worker = await held(context, codec); stop.abort(opaque.reason); worker.release();
			await exactRejection(reading, opaque.reason); await observed; opaque.assertUnreflected();
			assert.equal(worker.retired, 1);
			const count = workers.length;
			assert.deepEqual([...(await reader.chunk('audio', 0)).channels[0]!], [...raw]);
			assert.equal(workers.length, count + 1); opaque.assertUnreflected();
		} finally { for (const worker of workers) worker.release(); await observed; }
	});

	await t.test('a real worker CRC error already rejected by the broker survives later cancellation unchanged', async context => {
		const codec = client(true), stop = new AbortController(), opaque = opaqueReason();
		const reject = codec.requests.reject.bind(codec.requests); let actual: unknown;
		context.mock.method(codec.requests, 'reject', (id: string, error: unknown) => {
			actual = error; const settled = reject(id, error); stop.abort(opaque.reason); return settled;
		});
		const reading = codec.checksum(raw.buffer, { ...geometry, pcmCrc32: (crc32(raw.buffer) ^ 1) >>> 0, signal: stop.signal });
		const observed = outcome(reading);
		try {
			const worker = await held(context, codec); worker.release();
			const result = await observed; assert.equal(result.rejected, true);
			assert.ok(actual instanceof Error && 'code' in actual); assert.equal(actual.code, 'PCM_CRC_MISMATCH');
			if (result.rejected) assert.equal(result.error, actual);
			assert.equal(worker.retired, 0); opaque.assertUnreflected();
		} finally { for (const worker of workers) worker.release(); await observed; codec.close(); }
	});
});
