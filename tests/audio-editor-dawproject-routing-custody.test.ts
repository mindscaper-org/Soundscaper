/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAddTrackFolderCommand, createMoveTrackNodeCommand, createUpdateTrackFolderCommand } from '../src/common/editor/commands/factories.ts';
import { createSoundscaperProject, type SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { dawprojectArchiveCustody } from './helpers/dawproject-archive-custody.ts';
import { importedDawprojectArchiveCustody } from './helpers/imported-dawproject-archive-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

for (const routed of [false, true]) test(`DAW downstream route=${routed} preserves literal assignments, gains and original programme PCM through Scape`, async () => {
	const fixture = recording();
	const bus = { id: 'first', name: 'First bus', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const project = createSoundscaperProject({ ...fixture.project, mixer: { ...fixture.project.mixer,
		groups: [bus, { ...bus, id: 'second', name: 'Second bus', gain: .4 }],
		edges: [...fixture.project.mixer.edges.map(edge => edge.source.kind === 'track' ? { ...edge, destination: { kind: 'mixer-node', id: 'first' } } : edge),
			{ id: 'first-output', kind: 'assignment', source: { kind: 'mixer-node', id: 'first' }, destination: routed ? { kind: 'mixer-node', id: 'second' } : { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
			{ id: 'second-output', kind: 'assignment', source: { kind: 'mixer-node', id: 'second' }, destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }],
	} });
	const result = await dawprojectArchiveCustody(project, fixture.channels);
	const first = result.document.tracks.find(track => track.name === 'First bus')?.channel;
	const destination = result.document.tracks.find(track => routed ? track.name === 'Second bus' : track.channel?.role === 'master')?.channel;
	assert.ok(first && destination); assert.equal(first.destination, destination.id);
	assignment(result.project, 'Voice', 'First bus'); assignment(result.project, 'First bus', routed ? 'Second bus' : '$master');
	assignment(result.project, 'Second bus', '$master');
	assert.equal(result.project.mixer.groups.find(bus => bus.name === 'Second bus')?.gain, .4);
	assert.equal(result.project.mixer.groups.find(bus => bus.name === 'First bus')?.gain, 1);
	assertPcm(result.pcm);
});

for (const mute of [false, true]) for (const leafMute of [false, true]) test(`DAW folder mute=${mute} leaf=${leafMute} preserves independent structural gates and source PCM after Scape`, async () => {
	const fixture = recording(leafMute);
	let project = applySoundscaperProjectCommand(fixture.project, createAddTrackFolderCommand('main-sequence', { id: 'dialogue', name: 'Dialogue' }));
	project = applySoundscaperProjectCommand(project, createMoveTrackNodeCommand('main-sequence', 'voice', 'dialogue', 0));
	project = applySoundscaperProjectCommand(project, createUpdateTrackFolderCommand('dialogue', { mute }));
	const result = await dawprojectArchiveCustody(project, fixture.channels);
	const folder = result.document.tracks.find(track => track.name === 'Dialogue'); assert.ok(folder);
	assert.equal(folder.channel?.mute?.value, mute);
	assert.equal(folder.children.find(track => track.name === 'Voice')?.channel?.mute?.value, leafMute);
	assert.equal(result.project.trackFolders.find(folder => folder.name === 'Dialogue')?.mute, mute);
	assert.equal(result.project.tracks.find(track => track.name === 'Voice')?.mute, leafMute);
	assert.equal(result.project.mixer.groups.find(bus => bus.name === 'Dialogue')?.mute, false);
	assignment(result.project, 'Voice', 'Dialogue'); assignment(result.project, 'Dialogue', '$master');
	assertPcm(result.pcm);
});

for (const position of ['pre-fader', 'post-fader'] as const) test(`DAW ${position} send retains exact level, tap, source gain and PCM through actual archives`, async () => {
	const fixture = recording();
	let project = applySoundscaperProjectCommand(fixture.project, { type: 'mixer/bus-add', busType: 'send', bus: { id: 'wet', name: 'Wet' } });
	project = createSoundscaperProject({ ...project, tracks: project.tracks.map(track => ({ ...track, gain: .001 })), mixer: { ...project.mixer,
		edges: [...project.mixer.edges, { id: 'send', kind: 'send', source: { kind: 'track', id: 'voice' }, destination: { kind: 'mixer-node', id: 'wet' }, position, level: .4, enabled: true, channelMap: [0, 1] }],
	} });
	const result = await dawprojectArchiveCustody(project, fixture.channels);
	const send = result.document.tracks.find(track => track.name === 'Voice')?.channel?.sends[0]; assert.ok(send);
	assert.equal(send.type, position === 'pre-fader' ? 'pre' : 'post'); assert.equal(send.volume?.value, .4);
	const sends = result.project.mixer.edges.filter(edge => edge.kind === 'send'); assert.equal(sends.length, 1);
	assert.equal(sends[0]?.position, position); assert.equal(sends[0]?.level, .4); assert.deepEqual(sends[0]?.channelMap, [0, 1]);
	assert.equal(result.project.tracks.find(track => track.name === 'Voice')?.gain, .001);
	assignment(result.project, 'Voice', '$master'); assignment(result.project, 'Wet', '$master');
	assertPcm(result.pcm);
});

for (const nested of [false, true]) test(`foreign nested=${nested} folder routing and authored automation retain literal ancestry and PCM through archive delivery`, async () => {
	const inner = nested ? '<Track id="nested" name="Nested" contentType="tracks audio"><Channel id="inner-bus" role="submix" audioChannels="2" destination="bus"><Volume unit="linear" value=".7"/></Channel>' : '';
	const projectXml = `<Project version="1.0"><Structure><Track id="folder" name="Dialogue" contentType="tracks audio"><Channel id="bus" role="submix" audioChannels="2" destination="master"><Volume id="fader" unit="linear" value=".5"/></Channel>${inner}<Track id="child" name="Peer" contentType="audio"><Channel id="child-channel" role="regular" audioChannels="2" destination="bus"/></Track>${nested ? '</Track>' : ''}</Track><Track id="master-track" name="Master" contentType="audio"><Channel id="master" role="master" audioChannels="2"/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="folder"><Points unit="linear"><Target parameter="fader"/><RealPoint time="0" value=".2" interpolation="hold"/></Points></Lanes><Lanes track="child"><Clips><Clip time="0" duration=".1" contentTimeUnit="seconds"><Audio channels="2" sampleRate="48000" duration=".1"><File path="audio/voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`;
	const audio = new Blob([Uint8Array.from(encodeWav(pcm(), { sampleRate: 48_000, float: true }))]);
	const result = await importedDawprojectArchiveCustody(await writeDawprojectArchive({ projectXml, metadataXml: '<MetaData/>', files: [{ path: 'audio/voice.wav', blob: audio }] }));
	for (const project of [result.initial, result.project]) {
		const outer = project.trackFolders.find(folder => folder.name === 'Dialogue'); assert.ok(outer);
		const parent = nested ? project.trackFolders.find(folder => folder.name === 'Nested') : outer; assert.ok(parent);
		const peer = project.tracks.find(track => track.name === 'Peer'); assert.ok(peer);
		const membership = project.sequences.flatMap(sequence => sequence.trackNodes).find(node => node.kind === 'track' && node.id === peer.id);
		assert.equal(membership?.parentFolderId, parent.id); assert.equal(peer.gain, 1);
		assignment(project, 'Peer', parent.name); assignment(project, 'Dialogue', '$master');
		if (nested) { assignment(project, 'Nested', 'Dialogue'); assert.equal(project.mixer.groups.find(bus => bus.name === 'Nested')?.gain, 1); }
		// The authored automation replaces the .5 static fallback: .25 * .2 = .05.
		assert.equal(project.mixer.groups.find(bus => bus.name === 'Dialogue')?.gain, 1);
		const lane = project.automationLanes.find(lane => lane.address.kind === 'strip' && lane.address.strip.kind === 'mixer-node' && lane.address.strip.id === outer.id && lane.address.parameterId === 'gain'); assert.ok(lane);
		assert.deepEqual(lane.points.map(point => [point.position, point.value]), [[0, .2]]);
	}
	assertPcm(result.pcm);
});

function recording(mute = false) {
	const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	return { project: createSoundscaperProject({ id: crypto.randomUUID(), sources: [source], tracks: [createAudioTrack({ id: 'voice', name: 'Voice', mute, clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: 4800, durationFrames: 4800 })] }), channels: new Map([[source.storageKey, pcm()]]) };
}
function pcm() { return [new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)]; }
function assertPcm(values: ReadonlyMap<string, number[][]>): void {
	assert.equal(values.size, 1); assertPcmChannelsEqual([...values.values()][0], pcm().map(channel => Array.from(channel)));
}
function assignment(project: SoundscaperProject, sourceName: string, destinationName: string): void {
	const endpoint = (name: string) => {
		if (name === '$master') return { kind: 'master' as const };
		const track = project.tracks.find(track => track.name === name); if (track) return { kind: 'track' as const, id: track.id };
		const bus = [...project.mixer.groups, ...project.mixer.sends].find(bus => bus.name === name); assert.ok(bus);
		return { kind: 'mixer-node' as const, id: bus.id };
	};
	const source = endpoint(sourceName);
	const edges = project.mixer.edges.filter(edge => edge.kind === 'assignment' && edge.enabled && edge.source.kind === source.kind && ('id' in source ? 'id' in edge.source && edge.source.id === source.id : true));
	assert.equal(edges.length, 1); assert.deepEqual(edges[0]?.destination, endpoint(destinationName));
	assert.equal(edges[0]?.level, 1); assert.equal(edges[0]?.position, 'post-fader'); assert.deepEqual(edges[0]?.channelMap, [0, 1]);
}
