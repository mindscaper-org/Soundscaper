/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createTakeCycleLiveCaptureSpool } from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-live-capture-spool.ts';
import { SOURCE_CHUNK_FRAMES } from '../src/common/editor/source-pcm-contract.ts';

test('sealed live cycle finalization prepares one immutable manifest while freshly fencing every exact PCM chunk', async context => {
	const count = 64, frames = SOURCE_CHUNK_FRAMES;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `cycle-finalization-${crypto.randomUUID()}` });
	context.after(async () => { await store.close(); });
	const spool = createTakeCycleLiveCaptureSpool(store.rawPcmSpoolRepository);
	const writer = await spool.begin({ draftId: 'envelope', projectId: 'cycle-project', publicationGeneration: 1,
		envelopeId: 'envelope', groupId: 'group', laneId: 'lane-0', loopStartSample: 0, loopEndSample: frames,
		target: { trackId: 'track', sequenceId: 'sequence' }, source: { name: 'Cycle', sampleRate: 48_000, channelCount: 1, chunkFrames: frames },
		createPassIdentities: index => ({ laneId: `lane-${index}`, takeId: `take-${index}`, mediaId: `media-${index}`, journalId: `journal-${index}` }) });
	const pcm = new Float32Array(frames).fill(0.25);
	for (let index = 0; index < count; index++) await writer.append({ startSample: index * frames, endSample: (index + 1) * frames, channels: [pcm] });
	const draft = await writer.seal();
	const clone = globalThis.structuredClone, stringify = JSON.stringify;
	let copies = 0, serializations = 0, readFrames = 0;
	globalThis.structuredClone = function<T>(value: T, options?: StructuredSerializeOptions): T {
		if (hasManifest(value)) copies++;
		return clone(value, options);
	};
	JSON.stringify = function(value: unknown, ...rest: unknown[]): string | undefined {
		if (hasManifest(value)) serializations++;
		return Reflect.apply(stringify, JSON, [value, ...rest]) as string | undefined;
	} as typeof JSON.stringify;
	try {
		for (const source of draft.sources) for await (const channels of spool.readPass(draft, source.mediaId)) {
			assert.equal(channels.length, 1); assert.deepEqual(channels[0], pcm); readFrames += channels[0]!.length;
		}
		assert.equal(readFrames, count * frames);
		assert.ok(copies <= 40, `${copies} complete sealed-manifest copies`);
		assert.ok(serializations <= 24, `${serializations} complete sealed-manifest serializations`);
	} finally { globalThis.structuredClone = clone; JSON.stringify = stringify; }
	assert.equal(await spool.remove(draft), true);
});

function hasManifest(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const record = value as Readonly<Record<string, unknown>>;
	if (Array.isArray(record.captureSpans)) return true;
	return hasManifest(record.data) || hasManifest(record.draft) || hasManifest(record.lane)
		|| (Array.isArray(record.records) && (record.records as readonly unknown[]).some(hasManifest));
}
