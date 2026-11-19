/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { nativeMacroCustody } from './helpers/native-macro-import-custody.ts';

for (const [fields, expected] of [
	['Start="0.1" End="0.2"', [4800, 9600]],
	['Start="100" End="101"', [4_800_000, 4_848_000]],
	['Start="100"', [0, 4_800_000]],
] as const) test(`native file selection ${fields} retains its exact extent through library and archive reopen`, async context => {
	const { project } = await nativeMacroCustody(context, fixture(), `SelectTime:${fields} RelativeTo="ProjectStart"\n`);
	assert.deepEqual([project.selection.startFrame, project.selection.endFrame], expected);
});

for (const explicitEnd of [true, false]) test(`native file time defaults persist with explicitEnd=${String(explicitEnd)}`, async context => {
	const { project } = await nativeMacroCustody(context, fixture(), `SelectAll:\nSelectTime:Start="0.2"${explicitEnd ? ' End="0"' : ''}\n`);
	assert.deepEqual([project.selection.startFrame, project.selection.endFrame], [0, 9600]);
});

for (const partial of [false, true]) test(`native file frequency defaults persist with partial=${String(partial)}`, async context => {
	const { project } = await nativeMacroCustody(context, fixture(), `SelectAll:\nSelectFrequencies:${partial ? 'Low="500"' : 'Low="0" High="500"'}\n`);
	assert.deepEqual(project.selection.frequencyRange, { minimumFrequency: 0, maximumFrequency: 500 });
});

for (const command of ['', 'SelectAll:', 'SelAllTracks:']) test(`native file all-selection retains spectral scope after ${command || 'no further command'}`, async context => {
	const { project } = await nativeMacroCustody(context, fixture(),
		`SelectAll:\nSelectTime:Start="0.1" End="0.4"\nSelectFrequencies:Low="900" High="1100"\n${command}\n`);
	assert.deepEqual(project.selection.frequencyRange, { minimumFrequency: 900, maximumFrequency: 1100 });
	assert.deepEqual([project.selection.startFrame, project.selection.endFrame], command === 'SelectAll:' ? [0, 38_400] : [4800, 19_200]);
});

for (const clear of [false, true]) test(`native file deselection keeps the relative origin with clear=${String(clear)}`, async context => {
	const { project } = await nativeMacroCustody(context, fixture(),
		`SelectAll:\nSelectTime:Start="0.2" End="0.4"\n${clear ? 'SelectNone:\n' : ''}SelectTime:Start="0.1" End="0.3" RelativeTo="SelectionStart"\n`);
	assert.deepEqual([project.selection.startFrame, project.selection.endFrame], [14_400, 24_000]);
});

for (const [offset, empty, expectedStart] of [[0, false, 0], [9600, false, 9600], [9600, true, 0]] as const) {
	test(`native file SelectAll retains content origin with offset=${offset}, empty=${String(empty)}`, async context => {
		const { project } = await nativeMacroCustody(context, fixture(offset, empty), 'SelectAll:\n');
		assert.deepEqual([project.selection.startFrame, project.selection.endFrame], [expectedStart, offset + 38_400]);
	});
}

for (const navigate of [false, true]) test(`native file clip navigation retains spectral scope with navigate=${String(navigate)}`, async context => {
	const { project } = await nativeMacroCustody(context, fixture(),
		`SelectAll:\nSelectTime:Start="0" End="${navigate ? '0' : '0.8'}"\nSelectFrequencies:Low="900" High="1100"\n${navigate ? 'SelNextClip:\n' : ''}`);
	assert.deepEqual(project.selection.frequencyRange, { minimumFrequency: 900, maximumFrequency: 1100 });
	assert.deepEqual([project.selection.startFrame, project.selection.endFrame], [0, 38_400]);
});

for (const navigate of [false, true]) test(`native file aligned clip choice keeps the earliest end with navigate=${String(navigate)}`, async context => {
	const original = fixture();
	const shorter = createAudioClip({ id: 'short', sourceId: 'source', durationFrames: 28_800, sourceDurationFrames: 28_800, trimEndFrames: 9600 });
	const { project } = await nativeMacroCustody(context, createSoundscaperProject({ sampleRate: original.sampleRate, sources: original.sources,
		tracks: [...original.tracks, createAudioTrack({ id: 'short-track', clipIds: [shorter.id] })], clips: [...original.clips, shorter] }),
		`SelectAll:\nSelectTime:Start="0" End="${navigate ? '0' : '0.6'}"\n${navigate ? 'SelNextClip:\n' : ''}`);
	assert.deepEqual([project.selection.startFrame, project.selection.endFrame], [0, 28_800]);
});

function fixture(offset = 0, empty = false) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 38_400 });
	const clip = createAudioClip({ id: 'voice', sourceId: source.id, timelineStartFrame: offset, durationFrames: 38_400 });
	return createSoundscaperProject({ id: 'native-selection', sampleRate: 48_000, sources: [source], clips: [clip],
		tracks: [...(empty ? [createAudioTrack({ id: 'empty', name: 'Empty' })] : []), createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })] });
}
