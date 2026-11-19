/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportActionGroup } from '../src/common/editor/controller/export/export-action-group.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { parseAafDocument } from '../src/common/editor/aaf-import.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

function fixture() {
	const source = createAudioSource({ id: 'voice', storageKey: 'pcm-voice', name: 'Voice.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'cut', sourceId: source.id, title: 'Phrase', timelineStartFrame: 24_000, durationFrames: 24_000, sourceStartFrame: 12_000, sourceDurationFrames: 24_000 });
	return createSoundscaperProject({ id: 'project', title: 'AAF voice', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'a', name: 'Voice', clipIds: [clip.id] })], sampleRate: 48_000 });
}

test('Export Other AAF embeds readable PCM and publishes its report through the shared file service', async () => {
	const project = fixture(), saved: Readonly<Record<string, unknown>>[] = [];
	const state: { deliveryReport?: unknown } = {};
	const actions = createExportActionGroup({ getProject: () => project, state, persistSetting: () => undefined, handleExportAction: () => undefined,
		fileService: { saveFile: request => { saved.push(request); } },
		store: { loadMediaAsset: async () => null, async *readSourceChunks(id) {
			assert.equal(id, 'pcm-voice'); yield [new Float32Array(48_000).fill(.25)];
		} },
	});
	const exported = await actions.exportAaf();
	assert.ok(exported); assert.equal(saved.length, 1);
	assert.equal(saved[0]!.purpose, 'interchange'); assert.equal(state.deliveryReport, exported.report);
	const document = parseAafDocument(exported.bytes);
	assert.equal(document.tracks[0]!.clips[0]!.start.num / document.tracks[0]!.clips[0]!.start.den, .5);
	assert.ok(document.media[0]!.blob);
	const audio = await inspectWavBlobPcm(document.media[0]!.blob);
	assert.equal(audio.frameCount, 48_000); assert.equal(audio.channelCount, 1);
});

test('AAF staging excludes inaudible sources under the same solo projection as the writer', async () => {
	const base = fixture(), reads: string[] = [];
	const silent = createAudioSource({ id: 'absent', name: 'Missing.wav', storageKey: 'absent', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: base.id, title: base.title, sampleRate: base.sampleRate, sources: [...base.sources, silent],
		clips: [...base.clips, createAudioClip({ id: 'silent', sourceId: 'absent', durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		tracks: [{ ...base.tracks[0]!, solo: true }, createAudioTrack({ id: 'silent', clipIds: ['silent'] })] });
	const actions = createExportActionGroup({ getProject: () => project, state: {}, persistSetting: () => undefined, handleExportAction: () => undefined,
		store: { loadMediaAsset: async () => null, async *readSourceChunks(id) { reads.push(id); yield [new Float32Array(48_000)]; } },
	});
	await actions.exportAaf(); assert.deepEqual(reads, ['pcm-voice']);
});

test('AAF export refuses truncated PCM before publishing any file', async () => {
	const project = fixture(); let saved = false;
	const actions = createExportActionGroup({ getProject: () => project, state: {}, persistSetting: () => undefined, handleExportAction: () => undefined,
		fileService: { saveFile: () => { saved = true; } },
		store: { loadMediaAsset: async () => null, async *readSourceChunks() { yield [new Float32Array(100)]; } },
	});
	await assert.rejects(actions.exportAaf(), /ended before/u); assert.equal(saved, false);
});


test('AAF export refuses stale project authority before publishing', async () => {
	const project = fixture(); let current = project, saved = false;
	const actions = createExportActionGroup({ getProject: () => current, state: {}, persistSetting: () => undefined, handleExportAction: () => undefined,
		fileService: { saveFile: () => { saved = true; } },
		store: { loadMediaAsset: async () => null, async *readSourceChunks() {
			current = { ...project, title: 'Changed' }; yield [new Float32Array(48_000)];
		} },
	});
	await assert.rejects(actions.exportAaf(), /project changed/iu); assert.equal(saved, false);
});
