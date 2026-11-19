/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { clipPropertiesMediaRange } from '../src/common/editor/ui/inspector/clip-properties-media-range.ts';
import { clipboardDocument, clipboardPcm, clipboardProject, createClipboardCustody } from './helpers/clipboard-source-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const rows = [
	{ name: 'music-bed', tempo: 92, sourceIn: 2400, duration: 240_000, split: .42, gain: -2.5, fades: [4800, 9600], points: [.2, .72], stretch: true, nudge: 2, accent: false },
	{ name: 'podcast', tempo: 108, sourceIn: 4800, duration: 264_000, split: .35, gain: -1.25, fades: [2400, 7200], points: [.16, .61], stretch: false, nudge: -1, accent: true },
	{ name: 'dialogue', tempo: 132, sourceIn: 7200, duration: 216_000, split: .28, gain: 1.5, fades: [1200, 3600], points: [.12, .48], stretch: true, nudge: 1, accent: false },
] as const;

for (const row of rows) test(`${row.name} tempo edits preserve independent sample anchors, envelopes, lanes and PCM through history and Scape`, async context => {
	const f = await createClipboardCustody(context), { controller } = f;
	const source = createAudioSource({ id: 'recording', name: 'Long voice.wav', sampleRate: 48_000, frameCount: 384_000, channelCount: 2 });
	const pcm = [clipboardPcm(384_000), clipboardPcm(384_000, 1)];
	await f.open(createSoundscaperProject({ id: `tempo-${row.name}`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['phrase'] })],
		clips: [createAudioClip({ id: 'phrase', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })] }),
	new Map([[source.id, pcm]]));
	for (const [field, value] of [['sourceInFrame', row.sourceIn], ['durationFrame', row.duration]] as const) {
		const project = clipboardProject(controller.project), clip = resolveRuntimeProjectProjection(project).clips[0]; assert.ok(clip?.kind === 'audio');
		await controller.actions.clipSourcePreview.trim(clip.id, clipPropertiesMediaRange(clip, source.frameCount, field, value, { project, source }));
	}
	const envelope = [{ frame: 0, value: 1 }, ...row.points.map(position => ({ frame: Math.round(position * row.duration), value: 1 })), { frame: row.duration, value: 1 }];
	await controller.actions.clip.update('phrase', { gain: 10 ** (row.gain / 20), fadeInFrames: row.fades[0], fadeOutFrames: row.fades[1], envelope });
	if (row.stretch) await controller.actions.clip.toggleStretchToTempo('phrase');
	const split = Math.round(row.split * row.duration);
	await controller.actions.timeline.setExactSelection(split, split, { trackIds: ['voice'] });
	await controller.actions.transport.seek(split); await controller.actions.edit.split();
	// Native controls retain their gesture/mode witness; the saved lane is authored on the absolute sample clock.
	const points = [{ id: 'ride-start', position: 0, value: 1 }, { id: 'ride-later', position: Math.round(split / 2), value: 1 + row.nudge / 100 }];
	await controller.actions.edit.commit({ type: 'automation-lane/set', laneId: 'gain-ride', expected: null, lane: {
		id: 'gain-ride', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points, segments: [{ kind: 'linear' }],
	} });
	if (row.accent) {
		const bytes = encodeWav([new Float32Array(4800).fill(.5)], { sampleRate: 48_000, float: true }); assert.ok(bytes instanceof Uint8Array);
		await controller.actions.project.importFiles([new File([Uint8Array.from(bytes)], 'Accent.wav', { type: 'audio/wav' })], { destination: 'timeline' });
	}
	const authored = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
	await controller.actions.project.setTempo(row.tempo);
	const edited = clipboardProject(controller.project); assert.equal(edited.tempo.bpm, row.tempo);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	assert.deepEqual(edited.clips, authored.clips); assert.deepEqual(edited.automationLanes, authored.automationLanes);
	assert.deepEqual(edited.sources, authored.sources); assert.deepEqual(edited.tracks, authored.tracks);
	const clips = resolveRuntimeProjectProjection(edited).clips.filter(clip => clip.sourceId === source.id).sort((a, b) => a.timelineStartFrame - b.timelineStartFrame);
	assert.equal(clips.length, 2);
	assert.deepEqual(clips.map(clip => [clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.sourceDurationFrames]),
		[[0, row.sourceIn, split, split], [split, row.sourceIn + split, row.duration - split, row.duration - split]]);
	for (const [index, clip] of clips.entries()) {
		assert.ok(clip.kind === 'audio'); assert.equal(clip.gain, 10 ** (row.gain / 20)); assert.equal(clip.stretchToTempo, row.stretch);
		assert.deepEqual([clip.fadeInFrames, clip.fadeOutFrames], index ? [96, row.fades[1]] : [row.fades[0], 96]);
		const start = index ? split : 0, end = index ? row.duration : split;
		const expected = [0, ...row.points.map(position => Math.round(position * row.duration)).filter(frame => frame > start && frame < end).map(frame => frame - start), end - start];
		assert.deepEqual(clip.envelope, expected.map(frame => ({ frame, value: 1 })));
	}
	assert.deepEqual(edited.automationLanes[0], { id: 'gain-ride', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points, segments: [{ kind: 'linear' }] });
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(authored));
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	await f.archive((name, channels) => assertPcmChannelsEqual(channels, name === source.name ? pcm : [new Float32Array(4800).fill(.5)]));
});
