/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { parseXmlDocument, walkXml } from '../src/common/editor/dawproject-xml.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const automated of [false, true]) for (const route of ['foreign-folder', 'foreign-chain', 'ordinary-submix', 'master'] as const) test(`native DAWproject export closes ${route} bus references without exporting other sequence media${automated ? ' with automation' : ''}`, async context => {
	const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const base = createSoundscaperProject({ id: 'programme', title: 'Cross-sequence bus', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] }), createAudioTrack({ id: 'other', name: 'Other sequence recording' })],
		trackFolders: [...(route === 'foreign-chain' ? [{ id: 'parent', name: 'Parent bus', mute: true }] : []), { id: 'foreign', name: 'Foreign bus', mute: route === 'foreign-chain' }], primarySequenceId: 'first', sequences: [
			{ id: 'first', name: 'First', trackNodes: [{ kind: 'track', id: 'voice', parentFolderId: null }] },
			{ id: 'second', name: 'Second', trackNodes: [...(route === 'foreign-chain' ? [{ kind: 'folder', id: 'parent', parentFolderId: null }] : []), { kind: 'folder', id: 'foreign', parentFolderId: route === 'foreign-chain' ? 'parent' : null }, { kind: 'track', id: 'other', parentFolderId: 'foreign' }] },
		] });
	const foreign = base.mixer.groups[0]; assert.ok(foreign);
	const ordinary = { ...foreign, id: 'ordinary', name: 'Ordinary bus', gain: .4 };
	const destination = route === 'master' ? { kind: 'master' } : { kind: 'mixer-node', id: route.startsWith('foreign') ? foreign.id : ordinary.id };
	const project = createSoundscaperProject({ ...base, ...(automated ? { automationLanes: [{ id: 'gain-lane', address: { kind: 'strip', strip: { kind: 'mixer-node', id: route === 'ordinary-submix' ? ordinary.id : foreign.id }, parameterId: 'gain' }, timebase: 'absolute-samples', points: [{ id: 'gain-point', position: 0, value: .2 }], segments: [] }] } : {}), mixer: { ...base.mixer,
		groups: [...base.mixer.groups.map(group => ({ ...group, gain: .4 })), ...(route === 'ordinary-submix' ? [ordinary] : [])],
		edges: [...base.mixer.edges.map(edge => edge.source.kind === 'track' && edge.source.id === 'voice' ? { ...edge, destination } : edge),
			...(route === 'ordinary-submix' ? [{ id: 'ordinary-master', kind: 'assignment', source: { kind: 'mixer-node', id: ordinary.id },
				destination: { kind: 'master' }, level: 1, position: 'post-fader', enabled: true, channelMap: [0, 1] }] : [])],
	} });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }); context.after(async () => { await store.close(); });
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)]); await writer.commit();
	const files: Blob[] = [];
	const fixture = createFixture({ getProject: () => project, store, fileService: { isDesktop: false,
		chooseSaveTarget: async () => null, prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
		saveFile: async request => { assert.ok(request.blob instanceof Blob); files.push(request.blob); return { fileName: request.suggestedName }; },
	} });
	fixture.replaceProject(project.id); const before = structuredClone(project);
	await createNativeProjectService(fixture.runtime).saveDawproject(); assert.equal(files.length, 1); assert.deepEqual(project, before);
	const archive = await readDawprojectArchive(files[0]!);
	try {
		const nodes = [...walkXml(parseXmlDocument(archive.projectXml))];
		const ids = new Set(nodes.map(node => node.attributes.id).filter(Boolean));
		assert.deepEqual(nodes.flatMap(node => node.attributes.destination && !ids.has(node.attributes.destination) ? [node.attributes.destination] : []), [], 'every exported channel destination must exist');
		assert.equal(nodes.some(node => node.name === 'Track' && node.attributes.name === 'Other sequence recording'), false);
		assert.equal(nodes.some(node => node.name === 'Track' && node.attributes.name === foreign.name), route.startsWith('foreign'), 'retain only the required foreign bus, never unrelated sequence structure');
		if (automated && route !== 'master') assert.ok(nodes.some(node => node.name === 'RealPoint' && node.attributes.value === '0.2'), 'the retained bus keeps its authored gain lane');
		assert.equal(nodes.some(node => node.name === 'Track' && node.attributes.name === 'Parent bus'), route === 'foreign-chain');
		assert.equal(archive.entryNames.filter(path => path.endsWith('.wav')).length, 1);
	} finally { await archive.close(); }
});
