/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nyquistLabelTimelineRange } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-label-projection.ts';
import type { NyquistHostProject } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-host-service.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { readFileSync } from 'node:fs';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { selectionWav } from './helpers/selection-controller-custody.tsx';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';

for (const sourceRate of [32_000, 48_000]) {
	for (const scenario of [
		{ name: 'ordinary', repeated: false, reversed: false, offsetFrames: 0, expected: [57_600, 67_200] },
		{ name: 'repeated', repeated: true, reversed: false, offsetFrames: 0, expected: [57_600, 67_200] },
		{ name: 'reversed repeat', repeated: true, reversed: true, offsetFrames: 0, expected: [67_200, 76_800] },
		{ name: 'split repeat phase', repeated: true, reversed: false, offsetFrames: 19_200, expected: [76_800, 86_400] },
	]) {
		test(`source labels preserve their ${sourceRate} Hz sound position in a ${scenario.name} clip`, () => {
			const geometry = { id: 'clip', sourceId: 'source', timelineStartFrame: 48_000,
				reversed: scenario.reversed, sourceStartFrame: 0, sourceDurationFrames: Math.round(sourceRate * 0.8), durationFrames: 38_400 };
			const original = { ...createAudioClip(geometry), ...geometry };
			const clip = { ...original, ...(scenario.repeated ? clipLoopUpdateFields(original, {
				periodFrames: 38_400, durationFrames: 76_800, offsetFrames: scenario.offsetFrames,
			}) : {}) };
			const project = createSoundscaperProject({ id: 'project', now: '2026-10-08T04:00:00.000Z', sampleRate: 48_000,
				sources: [createAudioSource({ id: 'source', sampleRate: sourceRate, channelCount: 1,
					frameCount: Math.round(sourceRate * 0.8) })], clips: [clip],
				tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] }) as unknown as NyquistHostProject;
			assert.deepEqual(nyquistLabelTimelineRange(project, {
				start: 0.2, end: 0.4, text: 'Source cue', baseFrame: 0,
				sourceTarget: { sourceClipId: 'clip', sourceSampleRate: sourceRate, startFrame: 0 },
			}), scenario.expected);
		});
	}
}

test('shipping Nyquist reads the real looped source window and publishes source-clock labels through history and Scape', { timeout: 20_000 }, async context => {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const evaluator = await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	const input = selectionWav('browser-mono-tone.wav', 38_400, 1, 48_000, 440);
	const indexedDB = createInstrumentedIndexedDB(), store = createSoundscaperProjectStore({ indexedDB, preferOpfs: false });
	let evaluations = 0, nativeAccesses = 0;
	const forbidden = () => { nativeAccesses++; assert.fail('Source-window labels must not allocate, decode or render native audio.'); };
	const { controller } = await controllerSession(context, { store,
		engine: { ...createMemoryEngine(), decodeAudioData: async () => forbidden(), getAudioContext: async () => forbidden() } as unknown as Options['engine'],
		engineFactory: forbidden,
		nyquistEvaluator: (request: Parameters<typeof evaluator.evaluate>[0]) => {
			evaluations++; assert.equal(request.sampleRate, 48_000);
			assertPcmChannelsEqual(request.channels, input.pcm, 'every real source-window sample entering shipping WASM');
			const result = evaluator.evaluate(request);
			assert.equal(result.type, 'labels'); assert.deepEqual(result.labels, [{ start: .2, end: .4, text: 'Source cue' }]);
			return Promise.resolve(result);
		},
	});
	await controller.actions.project.importFiles([input.file]);
	const original = clipboardProject(controller.project), clip = original.clips[0], source = original.sources[0];
	assert.ok(clip?.kind === 'audio' && source?.kind === 'audio');
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 38_400, 1]);
	await controller.actions.clip.update(clip.id, { loop: { periodFrames: 38_400, durationFrames: 76_800, offsetFrames: 0 } });
	await controller.actions.timeline.selectClip(clip.id);
	controller.actions.effects.setSourceSelection({ clipId: clip.id, startFrame: 0, endFrame: 38_400 });
	const before = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
	assert.equal(before.clips[0]?.durationFrames, 76_800);
	const reads = () => {
		const requests: readonly unknown[] = indexedDB.stats.getRequests;
		return requests.filter(request => request !== null && typeof request === 'object' && Reflect.get(request, 'store') === 'sourceChunks').length;
	};
	const previousReads = reads();
	await controller.actions.nyquist.evaluate({ source: '\'((0.2 0.4 "Source cue"))', role: 'prompt', name: 'Nyquist prompt' });
	assert.equal(evaluations, 1); assert.equal(nativeAccesses, 0);
	assert.ok(reads() > previousReads, 'the shipping source-window loader reads actual durable PCM, without a supplied decoded buffer');
	const after = clipboardProject(controller.project), labels = after.tracks.filter(track => track.type === 'label');
	assert.equal(labels.length, 1); const target = labels[0]; assert.ok(target && Array.isArray(target.labels));
	assert.equal(target.name, 'Nyquist prompt'); assert.equal(target.labels.length, 1);
	const label: unknown = target.labels[0]; assert.ok(label && typeof label === 'object' && 'id' in label && typeof label.id === 'string');
	assert.deepEqual(label, { id: label.id, title: 'Source cue', startFrame: 9_600, endFrame: 19_200,
		color: 'auto', opaqueExtensions: {}, anchor: 'sample', startBeat: null, endBeat: null });
	assert.deepEqual(clipboardDocument(after), { ...clipboardDocument(before), tracks: [...before.tracks, target],
		sequences: before.sequences.map(sequence => sequence.id === before.primarySequenceId ? { ...sequence,
			trackIds: [...sequence.trackIds, target.id], trackNodes: [...sequence.trackNodes, { id: target.id, kind: 'track', parentFolderId: null }],
		} : sequence) });
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
	await controller.actions.project.flush({ forceCurrentSnapshot: true });
	const reopened = await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
		assert.equal(name, input.file.name); assertPcmChannelsEqual(channels, input.pcm, 'every original440Hz RIFF16 source sample');
	});
	assert.deepEqual(clipboardDocument(reopened), clipboardDocument(after)); assert.equal(nativeAccesses, 0);
});
