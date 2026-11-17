/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runStreamedEffectWorker } from '../src/common/editor/controller/effects/internal/streamed/worker-client.ts';
import { createNodeShippingWorkers } from './helpers/node-shipping-worker.ts';

test('shipping effect worker measures normalization across bounded reads and awaits every sink write', async context => {
	const workers = createNodeShippingWorkers(context), frames = 140003;
	const input = Float32Array.from({ length: frames }, (_, f) => f < 65536 ? .1 : .5);
	let written = 0, active = 0, largest = 0;
	await runStreamedEffectWorker({ effects: [{ type: 'audacity-normalize', params: { peakDb: 0, removeDc: false } }], sampleRate: 48000, channelCount: 1, frameCount: frames }, {
		assertCurrent: () => undefined,
		read: async (start, end) => { largest = Math.max(largest, end - start); return [input.slice(start, end)]; },
		write: async channels => { assert.equal(++active, 1); await new Promise<void>(resolve => setImmediate(resolve));
			for (const sample of channels[0]!) assert.equal(sample, written++ < 65536 ? Math.fround(.2) : 1); active--; },
	}, new AbortController().signal, () => workers.createWorker(new URL('./helpers/streamed-effect-worker-entry.ts', import.meta.url)));
	assert.equal(written, frames); assert.equal(largest, 65536); assert.equal(input.length, frames);
	await workers.dispose(); assert.ok(workers.snapshot().every(worker => worker.terminationRequested));
});
test('cancellation while a shipping worker awaits a read rejects promptly and fences its late result', async context => {
	const workers = createNodeShippingWorkers(context), abort = new AbortController();
	let started!: () => void, finish!: (value: Float32Array[]) => void, writes = 0;
	const reading = new Promise<void>(resolve => { started = resolve; });
	const pending = new Promise<Float32Array[]>(resolve => { finish = resolve; });
	const run = runStreamedEffectWorker({ effects: [{ type: 'audacity-invert', params: {} }], sampleRate: 48000, channelCount: 1, frameCount: 100 }, {
		assertCurrent: () => abort.signal.throwIfAborted(), read: async () => { started(); return pending; }, write: async () => { writes++; },
	}, abort.signal, () => workers.createWorker(new URL('./helpers/streamed-effect-worker-entry.ts', import.meta.url)));
	await reading; abort.abort(); await assert.rejects(run, { name: 'AbortError' }); finish([new Float32Array(100)]);
	await workers.dispose(); assert.equal(writes, 0);
});

test('shipping streams overlap one source read with a backpressured sink while bounding pending packets', async context => {
	const workers = createNodeShippingWorkers(context); let reads = 0, writes = 0;
	let release!: () => void;
	const readAhead = new Promise<void>(resolve => { release = resolve; });
	await runStreamedEffectWorker({ effects: [{ type: 'audacity-invert', params: {} }], sampleRate: 48000, channelCount: 1, frameCount: 140003 }, {
		assertCurrent: () => undefined,
		read: async (start, end) => { reads++; if (start === 65536) await readAhead; return [new Float32Array(end - start).fill(.5)]; },
		write: async () => { if (writes++ === 0) { assert.equal(reads, 2); release(); } },
	}, new AbortController().signal, () => workers.createWorker(new URL('./helpers/streamed-effect-worker-entry.ts', import.meta.url)));
	assert.equal(writes, 3); assert.equal(reads, 3);
});

test('an omitted worker subsystem retains bounded inline processing even when the browser offers Workers', async context => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class { constructor() { throw new Error('The omitted worker subsystem must not start.'); } } });
	context.after(() => { if (previous) Object.defineProperty(globalThis, 'Worker', previous); else Reflect.deleteProperty(globalThis, 'Worker'); });
	let output: Float32Array[] | undefined;
	await runStreamedEffectWorker({ effects: [{ type: 'audacity-invert', params: {} }], sampleRate: 48000, channelCount: 1, frameCount: 2 }, {
		assertCurrent: () => undefined, read: async () => [Float32Array.of(.5, -.25)], write: async channels => { output = channels; },
	}, new AbortController().signal, null);
	assert.deepEqual(output, [Float32Array.of(-.5, .25)]);
});
