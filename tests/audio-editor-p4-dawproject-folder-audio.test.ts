/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const send of [false, true]) for (const ownAudio of [true, false]) test(`DAWproject ${ownAudio ? 'folder-owned' : 'ordinary child'} audio remains inside its automated submix${send ? ' with a post-fader send' : ''}`, async context => {
	const clip = '<Clips><Clip time="0" duration=".1" contentTimeUnit="seconds"><Audio channels="2" sampleRate="48000" duration=".1"><File path="audio/voice.wav"/></Audio></Clip></Clips>';
	const sends = send ? '<Sends><Send destination="wet" type="post"><Volume unit="linear" value=".5"/></Send></Sends>' : '';
	const xml = `<Project version="1.0"><Application name="Folder items" version="1"/><Structure>
	<Track id="folder" name="Dialogue" contentType="tracks audio"><Channel id="bus" role="submix" audioChannels="2" destination="master"><Volume id="fader" unit="linear" value=".5"/>${sends}</Channel>
	<Track id="child" name="Peer" contentType="audio"><Channel id="child-channel" role="regular" audioChannels="2" destination="bus"/></Track></Track>
	${send ? '<Track id="return" name="Wet" contentType="audio"><Channel id="wet" role="effect" audioChannels="2" destination="master"/></Track>' : ''}
	<Track id="master-track" name="Master" contentType="audio"><Channel id="master" role="master" audioChannels="2"/></Track>
	</Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="folder">${ownAudio ? clip : ''}<Points unit="linear"><Target parameter="fader"/><RealPoint time="0" value=".2" interpolation="hold"/></Points></Lanes>
	<Lanes track="child">${ownAudio ? '' : clip}</Lanes></Lanes></Arrangement></Project>`;
	const pcm = [new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)];
	const audio = new Blob([Uint8Array.from(encodeWav(pcm, { sampleRate: 48_000, float: true }))]);
	const archive = await writeDawprojectArchive({ projectXml: xml, metadataXml: '<MetaData/>', files: [{ path: 'audio/voice.wav', blob: audio }] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), adaptAudacityProject: importSoundscaperAudacityProject,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openDawproject(new File([archive], 'Folder audio.dawproject'));
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	const track = project.tracks.find(track => track.type === 'audio' && track.clipIds.length); assert.ok(track);
	const folder = project.trackFolders.find(folder => folder.name === 'Dialogue'); assert.ok(folder);
	const lane = project.automationLanes.find(lane => lane.address.kind === 'strip' && lane.address.strip.kind === 'mixer-node'
		&& lane.address.strip.id === folder.id && lane.address.parameterId === 'gain'); assert.ok(lane);
	assert.equal(lane.points[0]?.value, .2, 'the channel automation itself survives import');
	const member = project.sequences.flatMap(sequence => sequence.trackNodes).find(node => node.kind === 'track' && node.id === track.id);
	assert.equal(member?.parentFolderId, folder.id, 'own audio must inherit the same folder bus as ordinary child audio');
	assert.equal(track.gain, 1, 'the original bus fader must not become a second leaf fader');
	const assignment = project.mixer.edges.find(edge => edge.kind === 'assignment' && edge.enabled && edge.source.kind === 'track' && edge.source.id === track.id);
	assert.deepEqual(assignment?.destination, { kind: 'mixer-node', id: folder.id });
	const importedSends = project.mixer.edges.filter(edge => edge.kind === 'send');
	assert.equal(importedSends.length, send ? 1 : 0);
	if (send) { assert.deepEqual(importedSends[0]?.source, { kind: 'mixer-node', id: folder.id }); assert.equal(importedSends[0]?.level, .5); }
	await controller.actions.project.flush(); const saved: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(saved));
	assert.deepEqual(saved.mixer, project.mixer); assert.deepEqual(saved.automationLanes, project.automationLanes);
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	const chunk = await store.readSourceChunk(source.storageKey, 0); assert.ok(chunk); assertPcmChannelsEqual(chunk.channels, pcm);
});
