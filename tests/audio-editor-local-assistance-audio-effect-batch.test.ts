/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalAssistancePreparationRuntime } from '../src/common/editor/controller/assistance/internal/local-assistance-runtime.ts';
import type { LocalAssistanceAudioEffectBatch, LocalAssistancePreparedMedia } from '../src/common/editor/assistance/local-assistance-preparation.ts';
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';
import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { AudioStore, model, output, SOURCE_SHA256 } from './helpers/local-assistance-audio-publication-fixture.ts';

type History = ReturnType<typeof createEditorHistory> & { present: AudioEditorProjectCurrent };

test('audio selection inventory deduplicates sources across selected tracks and occurrences', async () => {
	const fixture = batchFixture();
	const inventory = await fixture.runtime.listSelectedMedia();
	assert.deepEqual(inventory.sources.map(({ sourceId }) => sourceId), ['source-a', 'source-b']);
});

test('a drawn time range uses every selected track even when one clip identifier remains selected', async () => {
	const fixture = batchFixture({ startFrame: 2, endFrame: 16,
		trackIds: ['track-a', 'track-b'], clipIds: ['clip-a'] });
	const batch = await fixture.runtime.createAudioEffectBatch('enhance-dialogue');
	assert.equal(batch.preparations.length, 3);
	await batch.dispose();
});

test('disjoint clip selections process complete occurrences and preserve their gaps', async () => {
	const fixture = batchFixture({ startFrame: 0, endFrame: 0,
		trackIds: ['track-a', 'track-b'], clipIds: ['clip-a', 'clip-c'] });
	const batch = await fixture.runtime.createAudioEffectBatch('enhance-dialogue');
	assert.equal(batch.preparations.length, 2);
	await stageResult(fixture, batch, 0);
	await stageResult(fixture, batch, 1);
	await batch.commit();
	assert.deepEqual(fixture.renders, [
		['track-a', 0, 8, null, ['clip-a']], ['track-b', 0, 20, null, ['clip-c']],
	]);
	assert.ok(fixture.project().clips.some(({ id }) => id === 'clip-b'));
	assert.equal(fixture.project().selection.startFrame, 0);
	assert.equal(fixture.project().selection.endFrame, 0);
});

test('multiple selected audio intersections publish once and undo together after every result succeeds', async () => {
	const fixture = batchFixture();
	const original = fixture.project();
	const batch = await fixture.runtime.createAudioEffectBatch('enhance-dialogue');
	assert.equal(batch.preparations.length, 3);
	for (let index = 0; index < batch.preparations.length; index += 1) {
		await stageResult(fixture, batch, index);
		assert.strictEqual(fixture.project(), original, 'staging never mutates the document');
	}
	assert.equal(fixture.store.sources.size, 3);
	assert.deepEqual(fixture.renders, [
		['track-a', 2, 8, null, ['clip-a']], ['track-a', 12, 16, null, ['clip-b']],
		['track-b', 2, 16, null, ['clip-c']],
	]);
	await batch.commit();
	assert.equal(fixture.commits(), 1);
	assert.equal(fixture.project().projectBin.clips.length, 0);
	assert.equal(fixture.project().sources.length, 5);
	assert.equal(fixture.project().selection.clipIds?.length, 3);
	assert.equal(fixture.project().selection.startFrame, 2);
	assert.equal(fixture.project().selection.endFrame, 16);
	await batch.dispose();
	assert.equal(fixture.store.sources.size, 3, 'committed source custody survives disposal');
	fixture.undo();
	assert.deepEqual(fixture.project().clips, original.clips);
	assert.deepEqual(fixture.project().sources, original.sources);
	assert.deepEqual(fixture.project().tracks, original.tracks);
});

test('cancelled or incomplete batches discard staged audio and leave original media untouched', async () => {
	const fixture = batchFixture();
	const original = fixture.project();
	const batch = await fixture.runtime.createAudioEffectBatch('enhance-dialogue');
	await stageResult(fixture, batch, 0);
	await assert.rejects(batch.commit(), /incomplete/iu);
	assert.equal(fixture.store.sources.size, 0);
	assert.strictEqual(fixture.project(), original);
	await batch.dispose();
	await batch.dispose();
});

test('a changed original selection refuses final publication and releases every staged source', async () => {
	const fixture = batchFixture();
	const batch = await fixture.runtime.createAudioEffectBatch('enhance-dialogue');
	for (let index = 0; index < batch.preparations.length; index += 1) await stageResult(fixture, batch, index);
	fixture.changeSelection();
	await assert.rejects(batch.commit(), /selection|stale|current/iu);
	assert.equal(fixture.store.sources.size, 0);
	assert.equal(fixture.commits(), 0);
});

test('later persistence failure releases the earlier staged results without partial project edits', async () => {
	const fixture = batchFixture();
	const original = fixture.project();
	const batch = await fixture.runtime.createAudioEffectBatch('enhance-dialogue');
	await stageResult(fixture, batch, 0);
	const begin = fixture.store.beginSourceWrite.bind(fixture.store);
	fixture.store.beginSourceWrite = (id, metadata) => {
		fixture.store.failWriteFor = id;
		return begin(id, metadata);
	};
	await assert.rejects(stageResult(fixture, batch, 1), /storage exhausted/iu);
	await batch.dispose();
	assert.equal(fixture.store.sources.size, 0);
	assert.strictEqual(fixture.project(), original);
	assert.equal(fixture.commits(), 0);
});

async function stageResult(fixture: ReturnType<typeof batchFixture>, batch: LocalAssistanceAudioEffectBatch, index: number) {
	const preparation = batch.preparations[index]!;
	const inventory = await preparation.listSelectedMedia() as { sources: { sourceId: string }[] };
	const sourceId = inventory.sources[0]!.sourceId;
	const prepared = await preparation.prepareSelectedMedia({ sourceId, operation: 'speech-enhancement' }) as LocalAssistancePreparedMedia;
	const duration = prepared.selectionFence.sourceEndFrame - prepared.selectionFence.sourceStartFrame;
	await preparation.acceptValidatedResult!({ sourceId, operation: 'speech-enhancement',
		selectionFence: prepared.selectionFence, models: [model('speech-enhancement')],
		outputs: [await output('speech-enhancement', 'enhanced-audio', String(index + 1).repeat(40),
			[Array<number>(duration).fill(0.25), Array<number>(duration).fill(-0.125)])] });
	assert.ok(fixture.store.sources.size > 0);
}

function batchFixture(selection = { startFrame: 2, endFrame: 16, trackIds: ['track-a', 'track-b'], clipIds: [] as string[] }) {
	const sources = ['source-a', 'source-b'].map(id => createAudioSource({ id, storageKey: id,
		name: id, sampleRate: 48_000, frameCount: 32, channelCount: 2, contentSha256: SOURCE_SHA256 }));
	const clips = [
		createAudioClip({ id: 'clip-a', sourceId: 'source-a', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 8, durationFrames: 8 }),
		createAudioClip({ id: 'clip-b', sourceId: 'source-a', timelineStartFrame: 12,
			sourceStartFrame: 0, sourceDurationFrames: 8, durationFrames: 8 }),
		createAudioClip({ id: 'clip-c', sourceId: 'source-b', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 20, durationFrames: 20 }),
	];
	const tracks = [createAudioTrack({ id: 'track-a', clipIds: ['clip-a', 'clip-b'] }),
		createAudioTrack({ id: 'track-b', clipIds: ['clip-c'] })];
	let history = createEditorHistory(createCurrentAudioEditorProject({ id: 'batch-project', title: 'Batch',
		sampleRate: 48_000, sources, clips, tracks,
		selection,
		primarySequenceId: 'main-sequence', sequences: [{ id: 'main-sequence', trackIds: tracks.map(({ id }) => id) }],
	})) as History;
	const store = new AudioStore([]);
	let nextId = 0, commits = 0, selectionChanged = false;
	const renders: unknown[][] = [];
	const runtime = createLocalAssistancePreparationRuntime({
		getProject: () => ({ ...history.present, schemaFamily: 'soundscaper' as const, schemaVersion: 1,
			...(selectionChanged ? { selection: { ...history.present.selection, startFrame: 3 } } : {}) }),
		getSelectedClipId: () => null,
		captureProject: () => history.present,
		assertProject: token => assert.strictEqual(token, history.present),
		createId: prefix => `${prefix}-${String(++nextId)}`,
		preflightStorage: async () => undefined,
		renderDryTrackRange: async (...args) => {
			renders.push(args);
			return [new Float32Array(args[2] - args[1]), new Float32Array(args[2] - args[1])];
		},
		assistanceStore: {
			beginSourceWrite: (id: string, metadata: Readonly<Record<string, unknown>>) => store.beginSourceWrite(id, metadata),
			deleteSource: (id: string) => store.deleteSource(id),
			getMediaAssetMetadata: async () => null, loadMediaAsset: async () => null,
			beginMediaAssetWrite: async () => { throw new Error('Audio effects do not persist transcript bodies.'); },
		},
		commit: command => {
			commits += 1;
			history = executeEditorCommand(history, command as AudioEditorCommand) as History;
		},
	});
	return { runtime, store, renders, project: () => history.present, commits: () => commits,
		undo: () => { history = undoEditorCommand(history) as History; },
		changeSelection: () => { selectionChanged = true; } };
}
