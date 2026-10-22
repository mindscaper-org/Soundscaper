/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createExactPreviewRenderCoordinator } from '../src/common/editor/controller/clip-video/exact-preview-render-coordinator.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';
import { SourceReadRepository } from '../src/common/editor/storage/source-read-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import { createFramescaperSoundVisualizerWindowReader } from '../src/framescaper/sound-visualizer-window.ts';

async function rejectsWithIdentity(promise: Promise<unknown>, expected: unknown): Promise<void> {
	const result = await promise.then(() => ({ rejected: false as const }), (error: unknown) => ({ rejected: true as const, error }));
	assert.equal(result.rejected, true);
	if (result.rejected) assert.equal(Object.is(result.error, expected), true);
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(accept => { resolve = accept; });
	return { promise, resolve };
}

const visual: UnifiedExactRenderVisualFrameEntryV13 = {
	nodeId: 'visual', modelId: 'visual-clip', modelKind: 'sound-visualizer', trackId: 'video-track',
	opacity: 1, blendMode: 'normal', masks: [], authoredState: {
		source: { schemaVersion: 1, kind: 'generator', id: 'visual-source', name: 'Visualizer',
			width: 32, height: 16, frameRate: { num: 25, den: 1 }, frameCount: 100,
			generator: { kind: 'sound-visualizer', mode: 'spectrum', sourceIds: ['audio'], windowSeconds: 0.01,
				foregroundColor: '#ffffffff', backgroundColor: '#00000000' } },
		clip: { schemaVersion: 1, kind: 'generator', id: 'visual-clip', sourceId: 'visual-source',
			sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 100, sourceInFrame: 0, sourceFrameCount: 100 },
	},
};

async function fixture(t: TestContext, cut: 'metadata' | 'payload', failure?: Readonly<{ value: unknown }>) {
	const records = new SourceRecordRepository({ memory: getMemoryDatabase(`visual-cancel-${crypto.randomUUID()}`), database: async () => null });
	await records.putMetadata({ id: 'audio', sourceToken: 'token', storage: 'indexeddb-chunks',
		frameCount: 64, channelCount: 1, chunkFrames: 4, chunkCount: 16, sampleRate: 1_000 });
	for (let index = 0; index < 16; index += 1) await records.writeChunk({
		key: `token:${String(index).padStart(10, '0')}`, sourceToken: 'token', index, frames: 4,
		channels: [Float32Array.from({ length: 4 }, (_, offset) => (index * 4 + offset) / 64)],
	});
	const pcm = new PcmRepository();
	const source = new SourceReadRepository({ records, pcm, opfs: new OpfsRepository({ preferOpfs: false }) });
	const reader = createFramescaperSoundVisualizerWindowReader({ project: {
		sampleRate: 1_000, primarySequenceId: 'main',
		sequences: [{ id: 'main', trackIds: ['video-track', 'audio-track'] }],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['visual-clip'] },
			{ id: 'audio-track', type: 'audio', clipIds: ['audio-clip'] }],
		sources: [{ id: 'audio', kind: 'audio', storageKey: 'audio', frameCount: 64, channelCount: 1, chunkFrames: 4, sampleRate: 1_000 }],
		clips: [{ id: 'audio-clip', kind: 'audio', sourceId: 'audio', timelineStartFrame: 0,
			durationFrames: 64, sourceStartFrame: 0, sourceDurationFrames: 64 }],
	}, store: { readSourceChunk: source.chunk.bind(source) } });
	const started = deferred(), release = deferred();
	let held = false, expired = false;
	async function hold<Value>(value: Value): Promise<Value> {
		if (held) return value;
		held = true; started.resolve(); await release.promise;
		if (failure) throw failure.value;
		return value;
	}
	const readMetadata = records.getMetadata.bind(records), readPayload = records.chunk.bind(records);
	if (cut === 'metadata') t.mock.method(records, 'getMetadata', async (...args: Parameters<typeof readMetadata>) => hold(await readMetadata(...args)));
	else t.mock.method(records, 'chunk', async (...args: Parameters<typeof readPayload>) => hold(await readPayload(...args)));
	const deadline = setTimeout(() => { expired = true; started.resolve(); release.resolve(); }, 8_000);
	t.after(() => { clearTimeout(deadline); release.resolve(); reader.dispose(); pcm.closeOwnedCodec(); });
	return { reader, source, started, release, assertHeld: () => { assert.equal(held, true); assert.equal(expired, false); } };
}

for (const cut of ['metadata', 'payload'] as const) test(`superseded real visualizer ${cut} read joins without poisoning the next exact frame`, { timeout: 10_000 }, async t => {
	const f = await fixture(t, cut);
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('Supersession must not publish an automatic replacement.'), { mode: 'continuous' });
	const published: number[] = [], failures: unknown[] = [];
	let signal: AbortSignal | undefined, joined = false;
	const running = coordinator.run({ render: stop => { signal = stop; return f.reader.window(visual, 12, 0, stop); },
		isCurrent: () => true, publish: () => assert.fail('The cancelled frame cannot publish.'), onError: error => { failures.push(error); } });
	await f.started.promise; f.assertHeld(); assert.ok(signal);
	const replacing = coordinator.supersede();
	const observed = replacing.then(() => { joined = true; return { passed: true as const }; }, error => ({ passed: false as const, error: error as unknown }));
	try {
		assert.equal(signal.aborted, true); await Promise.resolve(); assert.equal(joined, false, 'The actual accepted record read still owns the frame.');
		f.release.resolve(); await running;
		const result = await observed;
		if (!result.passed) throw result.error;
		assert.equal(joined, true); assert.equal(failures.length, 0);
		await coordinator.run({ render: stop => f.reader.window(visual, 24, 1, stop), isCurrent: () => true,
			publish: frame => { assert.ok(frame.channels); assert.deepEqual([...frame.channels[0]!], Array.from({ length: 10 }, (_, i) => (19 + i) / 64)); published.push(frame.timelineFrame); },
			onError: error => { failures.push(error); } });
		assert.deepEqual(published, [1]); assert.deepEqual(failures, []); f.assertHeld();
	} finally { f.release.resolve(); await Promise.allSettled([running, observed, coordinator.retire()]); }
});

test('real source admission preserves an opaque cancelled reason without reflection', { timeout: 10_000 }, async t => {
	const f = await fixture(t, 'metadata');
	let traps = 0;
	const reason = new Proxy({}, { get() { traps += 1; throw new Error('Opaque get.'); },
		getPrototypeOf() { traps += 1; throw new Error('Opaque prototype.'); }, ownKeys() { traps += 1; throw new Error('Opaque keys.'); } });
	const stop = new AbortController(); stop.abort(reason);
	await rejectsWithIdentity(f.source.chunk('audio', 0, { signal: stop.signal }), reason);
	assert.equal(traps, 0);
});

test('a genuine record failure during supersession keeps its exact identity and fences replacement', { timeout: 10_000 }, async t => {
	let traps = 0;
	const reason = new Proxy({}, { get() { traps += 1; throw new Error('Opaque get.'); }, getPrototypeOf() { traps += 1; throw new Error('Opaque prototype.'); } });
	const f = await fixture(t, 'metadata', { value: reason });
	const coordinator = createExactPreviewRenderCoordinator(() => assert.fail('Failed cleanup cannot redraw.'), { mode: 'continuous' });
	const running = coordinator.run({ render: signal => f.reader.window(visual, 12, 0, signal),
		isCurrent: () => true, publish: () => assert.fail('Failed frame cannot publish.'), onError: () => assert.fail('Superseded error cannot publish.') });
	await f.started.promise; f.assertHeld();
	const replacing = coordinator.supersede();
	const rejected = rejectsWithIdentity(replacing, reason);
	try {
		f.release.resolve(); await Promise.all([running, rejected]);
		await rejectsWithIdentity(coordinator.run({ render: () => assert.fail('Failed owner cannot admit a replacement.'),
			isCurrent: () => true, publish: () => assert.fail('No frame.'), onError: () => assert.fail('No callback.') }), reason);
		assert.equal(traps, 0); f.assertHeld();
	} finally { f.release.resolve(); await Promise.allSettled([running, rejected, coordinator.retire()]); }
});
