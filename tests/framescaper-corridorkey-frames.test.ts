/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalAssistanceVideoKeyingFramePreparation } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-frames.ts';
import { reviewAssistanceVisualFramePackV2 } from '../src/common/editor/assistance/visual-frame-pack-v2.ts';
import type { LocalAssistanceVideoKeyingRun } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-publication.ts';
import { digestMediaContent } from '../src/common/media/content-digest.ts';

async function captured(): Promise<LocalAssistanceVideoKeyingRun> {
	return { projectId: 'project', clipId: 'clip', source: { id: 'source', contentSha256: await digestMediaContent(new Blob(['original'])) },
		width: 2, height: 2, sourceFrameCount: 3, frameRate: { num: 10, den: 1 }, timescale: 1_000,
		sourceEndTick: 300n, presentationTick: (ordinal) => BigInt(ordinal * 100),
		selectionFence: { projectId: 'project', schemaFamily: 'framescaper', schemaVersion: 1, revision: 0,
			sequenceId: 'main', occurrenceIds: ['clip'], sourceId: 'source', sourceSha256: '12'.repeat(32),
			sourceStartFrame: 0, sourceEndFrame: 3, linkMembershipSha256: '34'.repeat(32), timingAuthoritySha256: '56'.repeat(32) },
	};
}
test('full-source preparation decodes each exact source midpoint with complete rasters and ticks', async () => {
	const times: number[] = []; let disposed = false;
	const prepare = createLocalAssistanceVideoKeyingFramePreparation({ maximumPackBytes: 120,
		loadOriginal: async () => new Blob(['original']), createDecoder: async () => ({
			capture: async (timestamp) => { times.push(timestamp); return opaque(times.length); },
			dispose() { disposed = true; },
		}),
	});
	const packs = [];
	for await (const body of prepare(await captured(), { signal: new AbortController().signal, assertCurrent() {} })) {
		packs.push(reviewAssistanceVisualFramePackV2(new Uint8Array(await body.arrayBuffer())));
	}
	assert.deepEqual(times, [0.05, 0.15, 0.25]); assert.equal(disposed, true);
	assert.equal(packs.length, 3);
	assert.deepEqual(packs.map((pack) => pack.frameTiming(0)), [
		{ sourceFrame: 0, presentationTick: '0' }, { sourceFrame: 1, presentationTick: '100' }, { sourceFrame: 2, presentationTick: '200' },
	]);
	assert.deepEqual(packs.map((pack) => [...pack.frame(0).rgba]), [1, 2, 3].map((value) => [...opaque(value)]));
});
test('full-source preparation rejects a changed original before creating a decoder', async () => {
	let started = false;
	const prepare = createLocalAssistanceVideoKeyingFramePreparation({ loadOriginal: async () => new Blob(['changed']),
		createDecoder: async () => { started = true; throw new Error('must not decode'); } });
	await assert.rejects(async () => { for await (const body of prepare(await captured(), {
		signal: new AbortController().signal, assertCurrent() {},
	})) assert.fail(String(body)); }, /original video/u);
	assert.equal(started, false);
});
test('an interrupted frame-pack consumer still disposes its source decoder', async () => {
	let disposed = false;
	const prepare = createLocalAssistanceVideoKeyingFramePreparation({ maximumPackBytes: 120,
		loadOriginal: async () => new Blob(['original']), createDecoder: async () => ({
			capture: async () => opaque(0), dispose() { disposed = true; },
		}) });
	for await (const body of prepare(await captured(), { signal: new AbortController().signal, assertCurrent() {} })) {
		assert.ok(body.size > 0); break;
	}
	assert.equal(disposed, true);
});
test('unreported source alpha is rejected from actual decoded pixels and releases the decoder', async () => {
	let disposed = false;
	const prepare = createLocalAssistanceVideoKeyingFramePreparation({ loadOriginal: async () => new Blob(['original']),
		createDecoder: async () => ({ capture: async () => { const rgba = opaque(0); rgba[7] = 254; return rgba; },
			dispose() { disposed = true; } }) });
	await assert.rejects(async () => {
		for await (const body of prepare(await captured(), { signal: new AbortController().signal, assertCurrent() {} })) assert.fail(String(body));
	}, /already contains transparency/u);
	assert.equal(disposed, true);
});
function opaque(value: number): Uint8Array {
	const rgba = new Uint8Array(16).fill(value);
	for (let offset = 3; offset < rgba.length; offset += 4) rgba[offset] = 255;
	return rgba;
}
test('frame preparation reserves one job output claim for the encoded video', async () => {
	let loaded = false;
	const prepare = createLocalAssistanceVideoKeyingFramePreparation({ maximumPackBytes: 120,
		loadOriginal: async () => { loaded = true; return new Blob(['original']); } });
	const run = { ...await captured(), sourceFrameCount: 32 };
	await assert.rejects(async () => {
		for await (const body of prepare(run, { signal: new AbortController().signal, assertCurrent() {} })) assert.fail(String(body));
	}, /processing limit at this resolution/u);
	assert.equal(loaded, false);
});
test('frame preparation budgets paired packs plus the final native RGBA-sized encode reservation', async () => {
	let loaded = false;
	const prepare = createLocalAssistanceVideoKeyingFramePreparation({
		loadOriginal: async () => { loaded = true; return null; } });
	const run = { ...await captured(), width: 1920, height: 1080, sourceFrameCount: 400 };
	await assert.rejects(async () => {
		for await (const body of prepare(run, { signal: new AbortController().signal, assertCurrent() {} })) assert.fail(String(body));
	}, /processing limit at this resolution/u);
	assert.equal(loaded, false);
});
