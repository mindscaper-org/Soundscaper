/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { clipboardDocument, clipboardPcm, clipboardProject, createClipboardCustody } from './helpers/clipboard-source-custody.ts';
import { linkedClipboardFixture } from './helpers/linked-clipboard-project-fixture.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

for (const operation of ['create', 'remove'] as const) for (const linked of [false, true])
	test(`${operation} preserves ${linked ? 'linked' : 'managed'} clipboard media in the next project and independent native archive`, async context => {
		const { controller, store, project, pcm } = await linkedClipboardFixture(context, linked, linked ? 140_003 : 9600);
		await controller.actions.project[operation]();
		assert.notEqual(controller.project?.id, project.id); assert.equal(controller.getSnapshot().history.hasClipboard, true);
		assert.equal(Boolean(await store.loadProject(project.id)), operation === 'create');
		const empty = clipboardProject(controller.project);
		await controller.actions.edit.paste();
		const edited = clipboardProject(controller.project), clip = edited.clips[0], source = edited.sources[0];
		assert.ok(clip?.kind === 'audio' && source?.kind === 'audio');
		assert.deepEqual([edited.clips.length, edited.sources.length, clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.sourceDurationFrames],
			[1, 1, 0, 0, pcm.length, pcm.length]);
		assert.equal(clip.sourceId, source.id); assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, pcm.length, 1]);
		await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(empty));
		await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
		await controller.actions.project.flush();
		await assertAudioProjectArchivePcm(context, store, controller.project, (_name, channels) => assertPcmChannelsEqual(channels, [pcm]));
	});

const cuts = ['cutLeaveGap', 'labeledCut', 'labeledCutLeaveGap'] as const;
for (const action of cuts) test(`${action} publishes clipboard media only after an atomic successful edit and survives complete archive custody`, async context => {
	const f = await createClipboardCustody(context), { controller } = f;
	const sources = [createAudioSource({ id: 'a', name: 'Prior.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 2 }),
		createAudioSource({ id: 'b', name: 'Protected.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 2 })];
	const pcm = sources.map((_source, index) => [clipboardPcm(4800, index * 2), clipboardPcm(4800, index * 2 + 1)]);
	await f.open(createSoundscaperProject({ id: `atomic-${action}`, sources,
		tracks: [createAudioTrack({ id: 'prior', clipIds: ['clip-a'] }), createAudioTrack({ id: 'protected', clipIds: ['clip-b'] })],
		clips: sources.map((source, index) => createAudioClip({ id: index ? 'clip-b' : 'clip-a', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })) }),
	new Map(sources.map((source, index) => [source.id, pcm[index]!])));
	await controller.actions.timeline.selectClip('clip-a'); await controller.actions.edit.copy();
	const labeled = action === 'labeledCut' || action === 'labeledCutLeaveGap';
	if (labeled) {
		await controller.actions.timeline.setExactSelection(0, 4800, { trackIds: ['protected'], clipIds: [] });
		assert.ok(controller.actions.labels.add(null, { title: 'Cut range', startFrame: 1000, endFrame: 2000 }));
	} else await controller.actions.timeline.selectClip('clip-b');
	await controller.actions.timeline.selectTrack('protected');
	await controller.actions.track.update('protected', { locked: true });
	const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries;
	await controller.actions.edit[action]();
	assert.equal(controller.getSnapshot().status.state, 'error'); assert.deepEqual(controller.project, before);
	assert.deepEqual(controller.getSnapshot().history.undoEntries, history);
	const destination = controller.actions.track.add({ name: 'Destination' }); assert.ok(destination);
	await controller.actions.timeline.setExactSelection(0, 0, { trackIds: [destination], clipIds: [] }); await controller.actions.transport.seek(0);
	const baseline = clipboardProject(controller.project);
	await controller.actions.edit.paste();
	const pasted = clipboardProject(controller.project).clips.find(clip => !['clip-a', 'clip-b'].includes(clip.id)); assert.ok(pasted?.kind === 'audio');
	assert.deepEqual([pasted.sourceId, pasted.sourceStartFrame, pasted.sourceDurationFrames, pasted.durationFrames], ['a', 0, 4800, 4800]);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(baseline));
	await controller.actions.track.update('protected', { locked: false });
	if (labeled) await controller.actions.timeline.setExactSelection(0, 4800, { trackIds: ['protected'], clipIds: [] });
	else await controller.actions.timeline.selectClip('clip-b');
	const beforeCut = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
	await controller.actions.edit[action]();
	const cut = clipboardProject(controller.project);
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	const protectedWindows = resolveRuntimeProjectProjection(cut).clips.filter(clip => clip.sourceId === 'b').sort((a, b) => a.timelineStartFrame - b.timelineStartFrame)
		.map(clip => [clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.sourceDurationFrames]);
	assert.deepEqual(protectedWindows, labeled ? [[0, 0, 1000, 1000], [action === 'labeledCut' ? 1000 : 2000, 2000, 2800, 2800]] : []);
	assert.equal(cut.clips.filter(clip => clip.sourceId === 'a').length, 1);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(beforeCut));
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(cut));
	await controller.actions.timeline.setExactSelection(0, 0, { trackIds: [destination], clipIds: [] }); await controller.actions.transport.seek(0);
	await controller.actions.edit.paste();
	const edited = clipboardProject(controller.project), priorIds = new Set(cut.clips.map(clip => clip.id));
	const addition = edited.clips.find(clip => !priorIds.has(clip.id)); assert.ok(addition?.kind === 'audio');
	assert.deepEqual([addition.sourceId, addition.timelineStartFrame, addition.sourceStartFrame, addition.durationFrames, addition.sourceDurationFrames],
		['b', 0, labeled ? 1000 : 0, labeled ? 1000 : 4800, labeled ? 1000 : 4800]);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(cut));
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	await f.archive((name, channels) => {
		const index = sources.findIndex(source => source.name === name); assert.notEqual(index, -1); assertPcmChannelsEqual(channels, pcm[index]!);
	});
});
