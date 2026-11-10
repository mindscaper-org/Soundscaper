/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { clipboardDocument, clipboardProject, createClipboardCustody } from './helpers/clipboard-source-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

for (const pauses of [127, 128, 129]) test(`${pauses} real WAV pauses publish complete silence windows or refuse atomically through history and fresh Scape`, async context => {
	const f = await createClipboardCustody(context), { controller, store } = f;
	const pcm = Float32Array.from({ length: pauses * 1920 + 960 }, (_value, frame) => .2 * Math.sin(2 * Math.PI * 440 * frame / 48_000));
	for (let index = 0; index < pauses; index++) pcm.fill(0, 960 + index * 1920, 1920 + index * 1920);
	const bytes = encodeWav([pcm], { sampleRate: 48_000, float: true }); assert.ok(bytes instanceof Uint8Array);
	await controller.actions.project.importFiles([new File([Uint8Array.from(bytes)], 'Podcast pauses.wav', { type: 'audio/wav' })], { destination: 'timeline' });
	await controller.actions.timeline.selectAll(); await controller.actions.project.flush();
	const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries;
	assert.equal(before.clips.length, 1); assert.equal(before.sources.length, 1);
	if (pauses === 129) {
		await assert.rejects(controller.actions.edit.disjoin(), /More than 128 silent regions/iu);
		assert.deepEqual(controller.project, before); assert.deepEqual(controller.getSnapshot().history.undoEntries, history);
		assert.deepEqual(await store.loadProject(before.id), before);
	} else {
		await controller.actions.edit.disjoin();
		const edited = clipboardProject(controller.project), clips = resolveRuntimeProjectProjection(edited).clips;
		assert.equal(controller.getSnapshot().history.undoEntries.length, history.length + 1);
		assert.equal(clips.length, pauses + 1); assert.deepEqual(edited.sources, before.sources);
		// The authored 440 Hz sine is exactly quiet at every 600th frame. At each
		// fifth pause its last zero therefore extends the silent run by one frame.
		const expected = Array.from({ length: pauses + 1 }, (_value, index) => {
			const start = index === 0 ? 0 : index * 1920 + (index % 5 === 0 ? 1 : 0);
			const end = index === pauses ? pcm.length : 960 + index * 1920;
			return [start, start, end - start, end - start];
		});
		assert.deepEqual([...clips].sort((a, b) => a.timelineStartFrame - b.timelineStartFrame)
			.map(clip => [clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.sourceDurationFrames]), expected);
		assert.equal(new Set(clips.map(clip => clip.id)).size, clips.length);
		await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	}
	await f.archive((_name, actual) => assertPcmChannelsEqual(actual, [pcm]));
});

for (const touching of [false, true]) test(`${touching ? 'touching' : 'single'} real SRT scopes detach the complete quiet WAV interval through controller history and Scape`, async context => {
	const f = await createClipboardCustody(context), { controller } = f;
	const pcm = Float32Array.from({ length: 48_000 }, (_value, frame) => .35 * Math.sin(2 * Math.PI * 440 * frame / 48_000));
	pcm.fill(0, 9600, 28_800);
	const bytes = encodeWav([pcm], { sampleRate: 48_000, float: true }); assert.ok(bytes instanceof Uint8Array);
	const text = touching ? '1\n00:00:00,150 --> 00:00:00,400\nFirst\n\n2\n00:00:00,400 --> 00:00:00,650\nSecond\n\n'
		: '1\n00:00:00,150 --> 00:00:00,650\nInterview\n\n';
	await controller.actions.project.importFiles([new File([Uint8Array.from(bytes)], 'Interview.wav', { type: 'audio/wav' })], { destination: 'timeline' });
	await controller.actions.labels.importFile(new File([text], 'Interview.srt', { type: 'text/plain' }));
	await controller.actions.timeline.selectAll();
	const before = clipboardProject(controller.project), labels = before.tracks.find(track => track.type === 'label'); assert.ok(labels?.type === 'label');
	assert.deepEqual(labels.labels.map(label => [label.startFrame, label.endFrame, label.title]),
		touching ? [[7200, 19_200, 'First'], [19_200, 31_200, 'Second']] : [[7200, 31_200, 'Interview']]);
	const entries = controller.getSnapshot().history.undoEntries.length;
	await controller.actions.edit.labeledDisjoin();
	const edited = clipboardProject(controller.project), clips = resolveRuntimeProjectProjection(edited).clips;
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	assert.deepEqual(edited.tracks.find(track => track.type === 'label'), labels);
	assert.deepEqual([...clips].sort((a, b) => a.timelineStartFrame - b.timelineStartFrame)
		.map(clip => [clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.sourceDurationFrames]),
		[[0, 0, 9600, 9600], [28_801, 28_801, 19_199, 19_199]]);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	await f.archive((_name, actual) => assertPcmChannelsEqual(actual, [pcm]));
});
