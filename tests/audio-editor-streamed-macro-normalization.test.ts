/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStreamedMacroNormalizationService } from '../src/common/editor/controller/effects/internal/macro/streamed-macro-normalization.ts';
import type { EffectTarget } from '../src/common/editor/controller/effects/effect-selection-service.ts';
import type { EffectResultSourceWriter } from '../src/common/editor/controller/effects/internal/effect-result-service.ts';

function fixture(failAt: 'read' | 'write' | 'second-write' | 'commit' | 'activate' | 'publish' | 'cancel' | null = null) {
	const writes = new Map<string, Float32Array[][]>(), deleted: string[] = [], aborted: string[] = [], publications: unknown[] = [];
	const released: string[] = [];
	let id = 0, stale = false, largestRead = 0;
	const target: EffectTarget = { track: { id: 'track', name: 'LP', type: 'audio' }, startFrame: 17, endFrame: 140_017,
		durationFrames: 140_000, channelCount: 2, hasAudio: true };
	const service = createStreamedMacroNormalizationService({
		chunkFrames: 65_536, memoryLimitBytes: 256 * 1024 ** 2,
		getProject: () => ({ id: 'project', sources: [], clips: [], tracks: [] }),
		createId: () => `printed-${++id}`,
		read: async (_track, start, end) => {
			largestRead = Math.max(largestRead, end - start);
			if (failAt === 'read') throw new Error('read failed');
			return Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: end - start }, (_, frame) => (start + frame) % 2 ? .1 * (channel + 1) : -.1 * (channel + 1)));
		},
		store: {
			beginSourceWrite: async sourceId => {
				writes.set(sourceId, []);
				return {
					write(channels) { if (failAt === 'write' || failAt === 'second-write' && sourceId === 'printed-2') throw new Error('write failed'); writes.get(sourceId)!.push(channels.map(channel => channel.slice())); if (failAt === 'cancel') stale = true; },
					commit() { if (failAt === 'commit') throw new Error('commit failed'); },
					abort() { aborted.push(sourceId); },
				} satisfies EffectResultSourceWriter;
			},
			deleteSource: async sourceId => { deleted.push(sourceId); },
			saveAnalysis: async () => undefined, deleteAnalysis: async () => undefined,
		},
		publish: command => { if (failAt === 'publish') throw new Error('publish failed'); publications.push(command); },
		activateSource: async (_source, _signal, peaks) => { assert.equal(peaks.channelCount, 2); if (failAt === 'activate') throw new Error('activate failed'); },
		releaseSource: async sourceId => { released.push(sourceId); },
		prepareReplacement: (target, source) => ({ type: 'range/replace', trackId: target.track.id, startFrame: target.startFrame,
			endFrame: target.endFrame, source, clipId: `${source.id}-clip`, splitClipIds: {} }),
	});
	const run = (targets = 1) => service(Array.from({ length: targets }, (_, index) => ({ target: { ...target, track: { ...target.track, id: `track-${index}` } },
		effects: [{ type: 'audacity-normalize', params: { peakDb: -6, removeDc: false } }] })),
		{ effectName: 'LP normalization', sampleRate: 48_000, signal: new AbortController().signal,
			assertCurrent: () => { if (stale) throw new Error('Cancelled'); }, selectionDetails: { trackIds: ['track'], clipIds: [] } });
	return { run, writes, deleted, aborted, released, publications, largestRead: () => largestRead };
}

test('streamed macro normalization persists bounded PCM before one batch publication', async () => {
	const fixtureState = fixture(); await fixtureState.run();
	assert.equal(fixtureState.largestRead(), 65_536);
	const chunks = fixtureState.writes.get('printed-1')!;
	assert.deepEqual(chunks.map(chunk => chunk[0]!.length), [65_536, 65_536, 8_928]);
	const gain = Math.fround(10 ** (-6 / 20) / Math.fround(.2));
	assert.equal(chunks[0]![0]![0], Math.fround(Math.fround(.1) * gain));
	assert.equal(chunks.at(-1)![1]!.at(-1), Math.fround(-Math.fround(.2) * gain));
	assert.equal(fixtureState.publications.length, 1);
	assert.deepEqual(fixtureState.aborted, []); assert.deepEqual(fixtureState.deleted, []);
});

test('multiple streamed targets publish once and a later write failure releases every earlier source', async () => {
	const success = fixture(); await success.run(2);
	assert.equal(success.publications.length, 1);
	assert.equal(success.writes.size, 2);
	const failure = fixture('second-write'); await assert.rejects(failure.run(2), /write failed/u);
	assert.deepEqual(failure.publications, []);
	assert.deepEqual(failure.deleted, ['printed-1']);
	assert.deepEqual(failure.released, ['printed-1']);
	assert.deepEqual(failure.aborted, ['printed-2']);
});

for (const failure of ['read', 'write', 'commit', 'activate', 'publish', 'cancel'] as const) test(`streamed macro ${failure} failure leaves no publication or staged source`, async () => {
	const fixtureState = fixture(failure); await assert.rejects(fixtureState.run());
	assert.deepEqual(fixtureState.publications, []);
	if (failure === 'publish' || failure === 'activate') assert.deepEqual(fixtureState.deleted, ['printed-1']);
	else if (failure !== 'read') assert.deepEqual(fixtureState.aborted, ['printed-1']);
});
