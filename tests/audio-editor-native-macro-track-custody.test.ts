/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { nativeMacroCustody } from './helpers/native-macro-import-custody.ts';

for (const [command, explicit] of [['NewMonoTrack', false], ['NewStereoTrack', false], ['NewMonoTrack', true], ['NewLabelTrack', false], ['NewLabelTrack', true]] as const) {
	test(`native file ${command} removes only its created lane with explicit=${String(explicit)}`, async context => {
		const { project } = await nativeMacroCustody(context, fixture(['Voice']),
			`SelectAll:\n${command}:\n${explicit ? 'SelectTracks:Track="1" TrackCount="1" Mode="Set"\n' : ''}RemoveTracks:\n`);
		assert.deepEqual(project.tracks.map(track => track.name), ['Voice']);
		assert.equal(project.clips.length, 1);
		assert.equal(project.clips[0]?.durationFrames, 38_400);
	});
}

for (const lowercaseFirst of [true, false]) test(`native file name sorting removes the lowercase owner with lowercaseFirst=${String(lowercaseFirst)}`, async context => {
	const { project } = await nativeMacroCustody(context, fixture(lowercaseFirst ? ['b', 'B'] : ['B', 'b']),
		'SortByName:\nSelectTracks:Track="0" TrackCount="1" Mode="Set"\nRemoveTracks:\n');
	assert.deepEqual(project.tracks.map(track => track.name), ['B']);
	assert.equal(project.clips.length, 1);
});

for (const empty of [true, false]) test(`native file time sorting retains chronological lanes with empty=${String(empty)}`, async context => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 38_400 });
	const clips = [createAudioClip({ id: 'later', sourceId: source.id, timelineStartFrame: empty ? 9600 : 19_200, durationFrames: 38_400 }),
		...(empty ? [] : [createAudioClip({ id: 'earlier', sourceId: source.id, timelineStartFrame: 9600, durationFrames: 38_400 })])];
	const { project } = await nativeMacroCustody(context, createSoundscaperProject({ sampleRate: 48_000, sources: [source], clips,
		tracks: [createAudioTrack({ id: 'later', name: 'Later', clipIds: ['later'] }),
			createAudioTrack({ id: 'earlier', name: empty ? 'Empty' : 'Earlier', clipIds: empty ? [] : ['earlier'] })] }), 'SortByTime:\n');
	assert.deepEqual(project.tracks.map(track => track.name), empty ? ['Empty', 'Later'] : ['Earlier', 'Later']);
});

for (const nonzero of [false, true]) test(`native file Disjoin preserves archived quiet PCM with nonzero=${String(nonzero)}`, async context => {
	const values = new Float32Array(48_000);
	for (let frame = 0; frame < values.length; frame++) {
		const middle = frame >= 12_000 && frame < 36_000;
		values[frame] = Math.sin(2 * Math.PI * 1000 * frame / 48_000) * (middle ? (nonzero ? .0005 : 0) : .2);
	}
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const { project, store } = await nativeMacroCustody(context, createSoundscaperProject({ sampleRate: 48_000, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice'] })],
		clips: [createAudioClip({ id: 'voice', sourceId: source.id, durationFrames: 48_000 })] }),
	'SelectAll:\nDisjoin:\n', new Map([[source.id, [values]]]));
	assert.equal(project.clips.length, nonzero ? 1 : 2);
	assert.deepEqual(project.clips.map(clip => [clip.timelineStartFrame, clip.durationFrames]), nonzero ? [[0, 48_000]] : [[0, 12_000], [36_000, 12_000]]);
	assert.equal(project.sources.length, 1);
	const reopenedSource = project.sources[0]; assert.ok(reopenedSource);
	const restored: number[] = [];
	for await (const chunk of store.readSourceChunks(reopenedSource.storageKey)) restored.push(...chunk.channels[0]!);
	assert.equal(restored.length, 48_000);
	for (const frame of [100, 6001, 18_001, 24_001, 30_001, 42_001]) assert.equal(restored[frame], values[frame]);
	const peak = Math.max(...restored.slice(18_000, 30_000).map(Math.abs));
	if (nonzero) assert.ok(peak > .0003);
	else assert.equal(peak, 0);
});

test('ordinary local SelectAll still selects from zero after a native file and archive reopen', async context => {
	const original = fixture(['Voice'], 9600);
	const { controller, store } = await nativeMacroCustody(context, original, 'SelectAll:\n');
	assert.equal(controller.project?.selection.startFrame, 9600);
	controller.actions.timeline.selectAll();
	assert.deepEqual([controller.project?.selection.startFrame, controller.project?.selection.endFrame], [0, 48_000]);
	await controller.actions.project.flush();
	const persisted = await store.loadProject(controller.project!.id);
	assert.ok(persisted);
});

function fixture(names: readonly string[], offset = 0) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 38_400 });
	return createSoundscaperProject({ sampleRate: 48_000, sources: [source],
		tracks: names.map((name, index) => createAudioTrack({ id: `track-${index}`, name, clipIds: [`clip-${index}`] })),
		clips: names.map((_, index) => createAudioClip({ id: `clip-${index}`, sourceId: source.id, timelineStartFrame: offset, durationFrames: 38_400 })) });
}
