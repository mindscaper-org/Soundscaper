/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { normalizeAudioTrackFreezeV1 } from '../src/common/editor/audio-track-freeze-v21.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperAudioFreezeActions } from '../src/soundscaper/editor-audio-track-freeze-actions.ts';
import { audioRenderCustody, independentlyHashPcm } from './helpers/audio-render-custody.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertAudioProjectArchivePcm, readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

/** Independent RBJ low-pass recurrence; the production graph is never an oracle. */
function independentlyFiltered(input: Float32Array, frames: number): Float32Array {
	const angle = 2 * Math.PI * 20_000 / 48_000, cosine = Math.cos(angle), alpha = Math.sin(angle) / (2 * .707);
	const a0 = 1 + alpha, b0 = (1 - cosine) / (2 * a0), b1 = (1 - cosine) / a0;
	const a1 = -2 * cosine / a0, a2 = (1 - alpha) / a0, result = new Float32Array(frames);
	let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
	for (let frame = 0; frame < frames; frame++) {
		const x = input[frame] ?? 0, y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
		result[frame] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
	}
	return result;
}

for (const authenticated of [false, true]) test(`actual 96-sample pencil source authenticates and freezes with authenticated input=${authenticated}`, { timeout: 30_000 }, async context => {
	const resources: { freeze?: ReturnType<typeof createSoundscaperAudioFreezeActions> } = {};
	context.after(async () => { await resources.freeze?.dispose(); });
	const custody = await audioRenderCustody(context), { controller, store, native, playback } = custody;
	const original = createAudioSource({ id: 'original', name: 'Original.wav', frameCount: 96, sampleRate: 48_000, channelCount: 1 });
	const pcm = Float32Array.from({ length: 96 }, (_, frame) => Math.sin(2 * Math.PI * 1000 * frame / 48_000) * .25);
	const contentSha256 = independentlyHashPcm([pcm]);
	const source = authenticated ? { ...original, contentSha256 } : original;
	const project = createSoundscaperProject({ id: `rendered-identity-${authenticated}`, title: 'Rendered identity', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: original.id, title: 'Voice', sourceDurationFrames: 96, durationFrames: 96, speedRatio: 1, linkPitchAndTempo: true })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'], effects: [createEffect('lowpass', { id: 'filter', params: { frequency: 20_000, q: .707 } })] })] });
	await custody.open(project, new Map([[original.id, [pcm]]]));
	assert.equal(await playback.hashSourceContent(project.id, source), contentSha256);
	controller.actions.timeline.selectClip('clip'); controller.actions.timeline.setZoom(288_000);
	assert.equal(controller.getSnapshot().sampleEdit.available, true);
	const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
	await controller.actions.sampleEdit.pencil({ clipId: 'clip', channel: 0, points: [{ timelineFrame: 32, value: .5 }] });
	const edited = clipboardProject(controller.project), clip = edited.clips.find(clip => clip.id === 'clip'); assert.ok(clip?.kind === 'audio');
	const rendered = edited.sources.find(source => source.id === clip.sourceId); assert.ok(rendered?.kind === 'audio');
	assert.notEqual(rendered.id, original.id); assert.equal(rendered.contentSha256, undefined, 'new source must not inherit an authenticated original body hash');
	assert.deepEqual([rendered.frameCount, rendered.sampleRate, rendered.channelCount, rendered.chunkFrames], [96, 48_000, 1, 65_536]);
	const expected = new Float32Array(pcm); expected[32] = .5;
	assertPcmChannelsEqual(await readCustodyPcm(store, rendered), [expected], 'all original samples and the one public pencil point');
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	assert.equal(before.sources.find(source => source.id === original.id)?.contentSha256, authenticated ? contentSha256 : undefined);
	assert.equal(await playback.hashSourceContent(edited.id, rendered), independentlyHashPcm([expected]));
	controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	assertPcmChannelsEqual(await readCustodyPcm(store, original), [pcm], 'immutable input through sample history');
	const freeze = createSoundscaperAudioFreezeActions({ store, playback }, controller, { createRenderEngine: native.createEngine }); resources.freeze = freeze;
	const contexts = native.snapshot().offlineContexts;
	await freeze.actions.freeze('voice'); assert.equal(freeze.actions.getStatus('voice'), 'fresh');
	assert.equal(native.snapshot().offlineContexts, contexts + 1, 'actual SDK stored-provider track freeze');
	const frozen = clipboardProject(controller.project), track = frozen.tracks.find(track => track.id === 'voice'); assert.ok(track?.audioFreeze);
	const freezeRecord = normalizeAudioTrackFreezeV1(track.audioFreeze);
	assert.deepEqual(freezeRecord, track.audioFreeze, 'persisted Freeze record satisfies its owning schema unchanged');
	const derived = frozen.sources.find(source => source.id === freezeRecord.derivedSourceId); assert.ok(derived?.kind === 'audio');
	assert.deepEqual([derived.channelCount, derived.sampleRate, derived.chunkFrames], [1, 48_000, 65_536]);
	assert.equal(derived.frameCount, freezeRecord.renderFrameCount); assert.ok(derived.frameCount >= 96 && derived.frameCount < 48_000);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 2);
	const body = (await readCustodyPcm(store, derived))[0]!, filtered = independentlyFiltered(expected, derived.frameCount);
	for (let frame = 0; frame < body.length; frame++) {
		if (!(Math.abs(body[frame]! - filtered[frame]!) < 1e-6))
			assert.fail(`independent actual Freeze filter/frame${frame}: ${body[frame]} versus ${filtered[frame]}`);
	}
	assert.equal(derived.contentSha256, independentlyHashPcm([body]));
	controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(frozen));
	await controller.actions.project.flush(); assert.deepEqual(await store.loadProject(frozen.id), controller.project);
	await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
		assertPcmChannelsEqual(channels, [name === derived.name ? body : name === rendered.name ? expected : pcm], 'independent Scape-authenticated body');
	});
	assert.ok(native.snapshot().worklets.every(worklet => worklet.processorErrors.length === 0));
});
