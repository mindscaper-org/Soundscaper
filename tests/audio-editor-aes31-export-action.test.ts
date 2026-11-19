/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportActionGroup } from '../src/common/editor/controller/export/export-action-group.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { readAdlPackage } from '../src/common/editor/aes31-package.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

function fixture() {
	return createSoundscaperProject({ id: 'p', title: 'ADL voice', sampleRate: 48_000,
		sources: [createAudioSource({ id: 's', storageKey: 'pcm', name: 'Voice.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 })],
		clips: [createAudioClip({ id: 'c', sourceId: 's', title: 'Phrase', timelineStartFrame: 7, durationFrames: 24_000, sourceStartFrame: 17, sourceDurationFrames: 24_000 })],
		tracks: [createAudioTrack({ id: 't', clipIds: ['c'] })] });
}

test('ADL menu action packages referenced BWF audio and publishes the report', async () => {
	const project = fixture(), saved: Readonly<Record<string, unknown>>[] = [];
	const state: { deliveryReport?: unknown } = {};
	const actions = createExportActionGroup({ getProject: () => project, state, persistSetting: () => undefined, handleExportAction: () => undefined,
		fileService: { saveFile: request => { saved.push(request); } },
		store: { loadMediaAsset: async () => null, async *readSourceChunks(id) { assert.equal(id, 'pcm'); yield [new Float32Array(48_000).fill(.25)]; } } });
	const result = await actions.exportAdl();
	assert.ok(result); assert.equal(state.deliveryReport, result.report);
	assert.equal(saved[0]!.suggestedName, 'ADL-voice.adl.zip');
	const document = await readAdlPackage(saved[0]!.blob as Blob);
	assert.equal(document.tracks[0]!.clips[0]!.name, 'Phrase');
	const pcm = await inspectWavBlobPcm(document.media[0]!.blob!);
	assert.equal(pcm.frameCount, 48_000); assert.equal(pcm.channelCount, 1);
	assert.equal(pcm.bext?.timeReference, '0'); assert.ok(pcm.bext?.originatorReference);
});

test('ADL export aborts a prepared stream on truncated source or stale authority', async () => {
	for (const stale of [false, true]) {
		const project = fixture(); let current = project, aborted = false, committed = false;
		const actions = createExportActionGroup({ getProject: () => current, state: {}, persistSetting: () => undefined, handleExportAction: () => undefined,
			fileService: { prepareSave: async () => ({ mode: 'stream', bytesWritten: () => 0,
				createWritable: async () => new WritableStream({ write() {} }), commit: async () => { committed = true; return {}; }, abort: async () => { aborted = true; } }) },
			store: { loadMediaAsset: async () => null, async *readSourceChunks() { if (stale) current = { ...project }; yield [new Float32Array(stale ? 48_000 : 10)]; } } });
		await assert.rejects(actions.exportAdl(), stale ? /project changed/iu : /ended before/iu);
		assert.equal(aborted, true); assert.equal(committed, false);
	}
});

test('ADL export streams a complete ZIP before commit and honors save cancellation before reading PCM', async () => {
	for (const cancelled of [false, true]) {
		const project = fixture(), output: Uint8Array<ArrayBuffer>[] = [];
		let committed = false, reads = 0;
		const actions = createExportActionGroup({ getProject: () => project, state: {}, persistSetting: () => undefined, handleExportAction: () => undefined,
			fileService: { prepareSave: async () => cancelled ? { mode: 'cancelled' } : { mode: 'stream',
				createWritable: async () => new WritableStream<Uint8Array>({ write(chunk) { output.push(new Uint8Array(chunk)); } }),
				commit: async () => { const document = await readAdlPackage(new Blob(output)); assert.equal(document.tracks[0]!.clips[0]!.name, 'Phrase'); committed = true; return {}; },
				abort: async () => assert.fail('a valid stream must not abort') } },
			store: { loadMediaAsset: async () => null, async *readSourceChunks() { reads++; yield [new Float32Array(48_000).fill(.25)]; } } });
		const result = await actions.exportAdl();
		assert.equal(Boolean(result), !cancelled); assert.equal(committed, !cancelled); assert.equal(reads, cancelled ? 0 : 1);
	}
});
