/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createDefaultAdmMetadata } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { updateSoundscaperRoutingNode } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts';
import { createUpdateTempoEventCommand } from '../src/common/editor/commands/factories.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { dawprojectArchiveCustody } from './helpers/dawproject-archive-custody.ts';
import { importedDawprojectArchiveCustody } from './helpers/imported-dawproject-archive-custody.ts';

for (const [layout, channels] of [['mono', 1], ['stereo', 2], ['5.1', 6]] as const) test(`DAW and Scape delivery retain ${layout} master width and independent source PCM`, async () => {
	const fixture = recording();
	const project = applySoundscaperProjectCommand(fixture.project, { type: 'metadata/update',
		changes: { adm: createDefaultAdmMetadata(fixture.project, layout) } });
	const result = await dawprojectArchiveCustody(project, fixture.channels);
	assert.equal(result.document.tracks.find(track => track.channel?.role === 'master')?.channel?.audioChannels, channels);
	assert.equal(result.project.masterChannels, channels);
	assert.equal(result.project.mixer.outputs.find(output => output.role === 'main')?.channelCount, channels);
	assertPcm(result.pcm);
});

for (const busType of ['group', 'send'] as const) for (const channels of [1, 2, 6]) test(`DAW and Scape delivery retain a ${channels}-channel ${busType} and actual source PCM`, async () => {
	const fixture = recording();
	const withBus = applySoundscaperProjectCommand(fixture.project, { type: 'mixer/bus-add', busType,
		bus: { id: 'programme-bus', name: 'Programme bus' } });
	const collection = busType === 'group' ? 'groups' : 'sends';
	const resized = updateSoundscaperRoutingNode(withBus, withBus.mixer, collection, 'programme-bus', { name: 'Programme bus', channelCount: channels });
	const project = applySoundscaperProjectCommand(createSoundscaperProject({ ...withBus, mixer: resized.graph }),
		{ type: 'mixer/route-update', trackId: 'voice', changes: busType === 'group' ? { groupId: 'programme-bus' } : { sends: { 'programme-bus': .5 } } });
	const result = await dawprojectArchiveCustody(project, fixture.channels);
	assert.equal(result.document.tracks.find(track => track.name === 'Programme bus')?.channel?.audioChannels, channels);
	const bus = result.project.mixer[collection].find(item => item.name === 'Programme bus'); assert.ok(bus);
	assert.equal(bus.channelCount, channels);
	const connection = result.project.mixer.edges.find(edge => edge.destination.kind === 'mixer-node' && edge.destination.id === bus.id); assert.ok(connection);
	assert.equal(connection.kind, busType === 'group' ? 'assignment' : 'send');
	assert.equal(connection.level, busType === 'group' ? 1 : .5); assert.equal(connection.position, 'post-fader');
	assert.deepEqual(connection.channelMap, channels === 1 ? [0] : channels === 2 ? [0, 1] : [0, 1, -1, -1, -1, -1]);
	assertPcm(result.pcm);
});

for (const bpm of [999, 1000]) test(`DAW and Scape reopen retain ${bpm} BPM without changing source PCM`, async () => {
	const fixture = recording();
	const project = applySoundscaperProjectCommand(fixture.project, createUpdateTempoEventCommand('tempo-1', { bpm: { num: bpm, den: 1 } }));
	const result = await dawprojectArchiveCustody(project, fixture.channels);
	assert.deepEqual(result.project.tempoMap.events.map(event => event.bpm), [{ num: bpm, den: 1 }]);
	assert.equal(result.document.transport.tempo?.value, bpm);
	assert.ok(!result.report.items.some(item => item.code === 'dawproject.tempo-range-converted'));
	assertPcm(result.pcm);
});

for (const at of [-4, 0, null]) test(`foreign tempo point ${String(at)} retains literal programme and source clocks through archives`, async () => {
	const projectXml = `<Project version="1.0"><Transport><Tempo unit="bpm" value="120" id="tempo"/></Transport><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular" audioChannels="2"/></Track></Structure><Arrangement><Lanes timeUnit="beats"><Lanes track="voice"><Clips><Clip time="2" duration="2" contentTimeUnit="seconds"><Audio channels="2" sampleRate="48000" duration="2"><File path="voice.wav"/></Audio></Clip></Clips></Lanes></Lanes>${at === null ? '' : `<TempoAutomation unit="bpm"><Target parameter="tempo"/><RealPoint time="${at}" value="60" interpolation="hold"/></TempoAutomation>`}</Arrangement></Project>`;
	const channels = [new Float32Array(96_000).fill(.25), new Float32Array(96_000).fill(-.125)];
	const blob = await writeDawprojectArchive({ projectXml, metadataXml: '<MetaData/>', files: [{ path: 'voice.wav', blob: new Blob([Uint8Array.from(encodeWav(channels, { sampleRate: 48_000, float: true }))]) }] });
	const result = await importedDawprojectArchiveCustody(blob);
	const expectedFrames = at === null ? 48_000 : 96_000;
	for (const project of [result.initial, result.project]) {
		const clip = project.clips[0]; assert.ok(clip);
		assert.deepEqual([clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames], [expectedFrames, expectedFrames, 0, expectedFrames]);
	}
	assert.equal(result.pcm.size, 1);
	assertPcmChannelsEqual([...result.pcm.values()][0], channels.map(channel => Array.from(channel)));
});

function recording() {
	const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, channelCount: 2, frameCount: 4800 });
	const project = createSoundscaperProject({ id: crypto.randomUUID(), sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })] });
	return { project, channels: new Map([[source.storageKey, [new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)]]]) };
}

function assertPcm(pcm: ReadonlyMap<string, number[][]>): void {
	assert.equal(pcm.size, 1);
	assertPcmChannelsEqual([...pcm.values()][0], [new Array<number>(4800).fill(.25), new Array<number>(4800).fill(-.125)]);
}
