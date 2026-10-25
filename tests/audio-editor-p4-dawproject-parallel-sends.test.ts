/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { readDawprojectArchive, writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const sender of ['track', 'bus'] as const) for (const parallel of [true, false]) {
	test(`native DAWproject export preserves ${parallel ? 'parallel pre/post sends' : 'ordinary one-send'} ${sender} routing`, async context => {
		const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 480, channelCount: 2 });
		const base = createSoundscaperProject({ id: 'send-project', title: 'Send routing', sources: [source],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', durationFrames: 480, sourceDurationFrames: 480 })],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', gain: .5, clipIds: ['clip'] })] });
		const send = { id: 'wet', name: 'Wet', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
			collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
		const bus = { ...send, id: 'bus', name: 'Dry bus' };
		const sourceEndpoint = sender === 'bus' ? { kind: 'mixer-node', id: bus.id } : { kind: 'track', id: 'voice' };
		const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, groups: sender === 'bus' ? [bus] : [], sends: [send], edges: [
			...base.mixer.edges.flatMap(edge => {
				if (edge.source.kind !== 'track') return [edge];
				if (sender === 'bus') return [{ ...edge, destination: { kind: 'mixer-node' as const, id: bus.id } }];
				return [edge];
			}),
			...(sender === 'bus' ? [{ id: 'bus-dry', kind: 'assignment', source: sourceEndpoint, destination: { kind: 'master' },
				position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }] : []),
			...(parallel ? [{ id: 'voice-wet-pre', kind: 'send', source: sourceEndpoint, destination: { kind: 'mixer-node', id: send.id },
				position: 'pre-fader', level: .2, enabled: true, channelMap: [0, 1] }] : []),
			{ id: 'voice-wet', kind: 'send', source: sourceEndpoint, destination: { kind: 'mixer-node', id: send.id },
				position: 'post-fader', level: .3, enabled: true, channelMap: [0, 1] },
			{ id: 'wet-master', kind: 'assignment', source: { kind: 'mixer-node', id: send.id }, destination: { kind: 'master' },
				position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
		] } });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
		const destination = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
		context.after(async () => { await store.close(); await destination.close(); });
		const pcm = [new Float32Array(480).fill(.25), new Float32Array(480).fill(-.125)];
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write(pcm); await writer.commit();
		const files: Blob[] = [];
		const exporting = createFixture({ getProject: () => project, store, fileService: { isDesktop: false, chooseSaveTarget: async () => null,
			prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
			saveFile: async request => { assert.ok(request.blob instanceof Blob); files.push(request.blob); return { fileName: request.suggestedName }; },
		} });
		exporting.replaceProject(project.id); const before = structuredClone(project);
		await createNativeProjectService(exporting.runtime).saveDawproject(); assert.equal(files.length, 1); assert.deepEqual(project, before);
		const archive = await readDawprojectArchive(files[0]!);
		try {
			const document = parseDawprojectDocument(archive.projectXml, archive.metadataXml);
			const channel = document.tracks.find(track => track.name === (sender === 'bus' ? bus.name : 'Voice'))?.channel;
			assert.ok(channel); assert.deepEqual(channel.sends.map(send => [send.volume?.value, send.type]), parallel ? [[.2, 'pre'], [.3, 'post']] : [[.3, 'post']]);
			const dry = document.tracks.find(track => track.channel?.id === channel.destination)?.channel;
			assert.ok(dry); assert.equal(dry.role, 'master');
		} finally { await archive.close(); }
		let nextId = 0;
		const importing = createFixture({ store: destination, adaptAudacityProject: importSoundscaperAudacityProject,
			createStableId: prefix => `${prefix}-${++nextId}`,
		});
		const opened = await createNativeProjectService(importing.runtime).openDawproject(new File([files[0]!], 'Send routing.dawproject'));
		assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
		const voice = opened.project.tracks.find(track => track.type === 'audio' && track.name === 'Voice'); assert.ok(voice);
		const senderId = sender === 'bus' ? opened.project.mixer.groups.find(group => group.name === bus.name)?.id : voice.id;
		assert.ok(senderId);
		const dry = opened.project.mixer.edges.find(edge => edge.kind === 'assignment'
			&& edge.source.kind !== 'master' && edge.source.kind === sourceEndpoint.kind && edge.source.id === senderId && edge.enabled);
		assert.ok(dry);
		assert.equal(dry.destination.kind, 'master');
		const sends = opened.project.mixer.edges.filter(edge => edge.kind === 'send' && edge.source.kind === sourceEndpoint.kind
			&& edge.source.kind !== 'master' && edge.source.id === senderId);
		assert.deepEqual(sends.map(send => [send.level, send.position]), parallel ? [[.2, 'pre-fader'], [.3, 'post-fader']] : [[.3, 'post-fader']]);
		const importedSource = opened.project.sources[0]; assert.ok(importedSource?.kind === 'audio');
		const chunk = await destination.readSourceChunk(importedSource.storageKey, 0); assert.ok(chunk); assertPcmChannelsEqual(chunk.channels, pcm);
});
}

for (const role of ['regular', 'submix'] as const) test(`File Open retains repeated pre/post sends from one ${role} channel`, async () => {
	const xml = `<Project version="1.0"><Structure>
		<Track id="sender-track" name="Sender" contentType="audio"><Channel id="sender" role="${role}" audioChannels="2" destination="master">
		<Sends><Send id="pre" destination="wet" type="pre"><Volume unit="linear" value="0.2"/></Send>
		<Send id="post" destination="wet" type="post"><Volume unit="linear" value="0.3"/></Send></Sends><Volume unit="linear" value="0.5"/></Channel></Track>
		<Track id="return-track" name="Wet" contentType="audio"><Channel id="wet" role="effect" audioChannels="2" destination="master"/></Track>
		<Track id="master-track" name="Master" contentType="audio"><Channel id="master" role="master" audioChannels="2"/></Track>
		</Structure></Project>`;
	const archive = await writeDawprojectArchive({ projectXml: xml, metadataXml: '<MetaData/>', files: [] });
	let nextId = 0;
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject, createStableId: prefix => `${prefix}-${++nextId}` });
	const result = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Parallel sends.dawproject'));
	assert.ok(result); assert.ok(validateSoundscaperProject(result.project));
	assert.deepEqual(result.project.mixer.edges.filter(edge => edge.kind === 'send').map(edge => [edge.level, edge.position]),
		[[.2, 'pre-fader'], [.3, 'post-fader']]);
});
