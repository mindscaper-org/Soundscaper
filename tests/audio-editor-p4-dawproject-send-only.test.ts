/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const sender of ['track', 'bus', 'disabled-assignment'] as const) for (const sendOnly of [true, false]) {
	if (sender === 'disabled-assignment' && !sendOnly) continue;
	test(`native DAWproject export preserves ${sendOnly ? 'send-only' : 'ordinary dry and send'} ${sender} routing`, async context => {
		const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 480, channelCount: 2 });
		const base = createSoundscaperProject({ id: 'send-project', title: 'Send routing', sources: [source],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', durationFrames: 480, sourceDurationFrames: 480 })],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
		const send = { id: 'wet', name: 'Wet', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
			collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
		const bus = { ...send, id: 'bus', name: 'Dry bus' };
		const sourceEndpoint = sender === 'bus' ? { kind: 'mixer-node', id: bus.id } : { kind: 'track', id: 'voice' };
		const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, groups: sender === 'bus' ? [bus] : [], sends: [send], edges: [
			...base.mixer.edges.flatMap(edge => {
				if (edge.source.kind !== 'track') return [edge];
				if (sender === 'bus') return [{ ...edge, destination: { kind: 'mixer-node' as const, id: bus.id } }];
				if (sender === 'disabled-assignment') return [{ ...edge, enabled: false }];
				return sendOnly ? [] : [edge];
			}),
			...(sender === 'bus' && !sendOnly ? [{ id: 'bus-dry', kind: 'assignment', source: sourceEndpoint, destination: { kind: 'master' },
				position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }] : []),
			{ id: 'voice-wet', kind: 'send', source: sourceEndpoint, destination: { kind: 'mixer-node', id: send.id },
				position: 'post-fader', level: .4, enabled: true, channelMap: [0, 1] },
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
			assert.ok(channel); assert.equal(channel.sends.length, 1); assert.equal(channel.sends[0]?.volume?.value, .4);
			const dry = document.tracks.find(track => track.channel?.id === channel.destination)?.channel;
			assert.ok(dry); assert.equal(dry.mute?.value === true, sendOnly, 'a send-only channel must never gain a dry programme path');
			if (!sendOnly) assert.equal(dry.role, 'master');
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
		if (sendOnly) {
			assert.ok(dry.destination.kind === 'mixer-node');
			const destinationId = dry.destination.id;
			assert.equal(opened.project.mixer.groups.find(group => group.id === destinationId)?.mute, true);
		} else assert.equal(dry.destination.kind, 'master');
		const importedSource = opened.project.sources[0]; assert.ok(importedSource?.kind === 'audio');
		const chunk = await destination.readSourceChunk(importedSource.storageKey, 0); assert.ok(chunk); assert.deepEqual(chunk.channels, pcm);
});
}
