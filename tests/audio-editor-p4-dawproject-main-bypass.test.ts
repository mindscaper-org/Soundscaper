/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseXmlDocument, walkXml } from '../src/common/editor/dawproject-xml.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const sender of ['track', 'bus'] as const) for (const bypass of [true, false, 'secondary'] as const) {
	test(`native DAWproject export preserves ${sender} ${bypass === 'secondary' ? 'nonprogramme output' : bypass ? 'Master bypass' : 'Master processing'}`, async context => {
		const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 480, channelCount: 2 });
		const base = createSoundscaperProject({ id: 'bypass-project', title: 'Master bypass', sources: [source],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', durationFrames: 480, sourceDurationFrames: 480 })],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
		const output = base.mixer.outputs.find(candidate => candidate.role === 'main'); assert.ok(output);
		const bus = { id: 'bus', name: 'Dry bus', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
			collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
		const destination = bypass === 'secondary' ? { kind: 'output' as const, id: 'cue-output' } : bypass ? { kind: 'output' as const, id: output.id } : { kind: 'master' as const };
		const project = createSoundscaperProject({ ...base, master: { ...base.master, gain: 0 }, mixer: { ...base.mixer,
			outputs: [...base.mixer.outputs, ...(bypass === 'secondary' ? [{ id: 'cue-output', name: 'Cue output', role: 'cue', channelCount: 2 }] : [])],
			groups: sender === 'bus' ? [bus] : [], edges: [
				...base.mixer.edges.map(edge => edge.source.kind === 'track'
					? { ...edge, destination: sender === 'bus' ? { kind: 'mixer-node' as const, id: bus.id } : destination } : edge),
				...(sender === 'bus' ? [{ id: 'bus-output', kind: 'assignment', source: { kind: 'mixer-node', id: bus.id },
					destination, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }] : []),
			] } });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
		context.after(() => store.close());
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(480).fill(.25), new Float32Array(480).fill(-.125)]); await writer.commit();
		let saved: Blob | undefined;
		const fixture = createFixture({ getProject: () => project, store, fileService: { isDesktop: false, chooseSaveTarget: async () => null,
			prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
			saveFile: async request => { assert.ok(request.blob instanceof Blob); saved = request.blob; return { fileName: request.suggestedName }; },
		} });
		fixture.replaceProject(project.id); const original = structuredClone(project);
		await createNativeProjectService(fixture.runtime).saveDawproject(); assert.ok(saved); assert.deepEqual(project, original);
		const archive = await readDawprojectArchive(saved);
		try {
			const document = parseDawprojectDocument(archive.projectXml, archive.metadataXml);
			const channel = document.tracks.find(track => track.name === (sender === 'track' ? 'Voice' : bus.name))?.channel; assert.ok(channel);
			const target = document.tracks.find(track => track.channel?.id === channel.destination)?.channel; assert.ok(target);
			assert.equal(target.volume?.value, bypass ? 1 : 0, 'a direct output must not acquire the original Master fader');
			if (bypass === 'secondary') assert.equal(target.mute?.value, true, 'a nonprogramme output must never become audible in main');
			if (bypass === true) {
				assert.equal(target.role, 'master');
				assert.ok(document.tracks.some(track => track.name === 'Master' && track.channel?.volume?.value === 0),
					'the original Master processing must remain available to ordinary routes');
			}
		} finally { await archive.close(); }
	});
}

test('DAWproject Master conversion retains original automation parameter and ordinary routing identities', () => {
	const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 480, channelCount: 2 });
	const base = createSoundscaperProject({ id: 'mixed', title: 'Mixed', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 480, sourceDurationFrames: 480 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Bypass', clipIds: ['clip'] }), createAudioTrack({ id: 'ordinary', name: 'Ordinary' })] });
	const output = base.mixer.outputs.find(candidate => candidate.role === 'main'); assert.ok(output);
	const project = createSoundscaperProject({ ...base, master: { ...base.master, gain: .2 }, automationLanes: [{ id: 'master-gain',
		address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' }, timebase: 'absolute-samples',
		points: [{ id: 'point', position: 0, value: .4 }], segments: [],
	}], mixer: { ...base.mixer, edges: base.mixer.edges.map(edge => edge.source.kind === 'track' && edge.source.id === 'voice'
		? { ...edge, destination: { kind: 'output', id: output.id } } : edge) } });
	const exported = createDawprojectExport({ project });
	const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
	const master = document.tracks.find(track => track.name === 'Master')?.channel; assert.ok(master);
	assert.equal(master.role, 'submix'); assert.equal(master.volume?.value, .2);
	assert.equal(document.tracks.find(track => track.name === 'Ordinary')?.channel?.destination, master.id);
	const terminal = document.tracks.find(track => track.channel?.role === 'master')?.channel; assert.ok(terminal);
	assert.equal(master.destination, terminal.id); assert.equal(terminal.volume?.value, 1);
	assert.equal(document.tracks.find(track => track.name === 'Bypass')?.channel?.destination, terminal.id);
	const points = [...walkXml(parseXmlDocument(exported.projectXml))].find(node => node.name === 'Points'
		&& node.children.some(child => child.name === 'Target' && child.attributes.parameter === master.volume?.id));
	assert.ok(points?.children.some(child => child.name === 'RealPoint' && child.attributes.value === '0.4'));
	assert.equal(exported.report.items.some(item => item.code === 'dawproject.automation-omitted'), false);
});

test('DAWproject does not split the Master for a bypass owned only by an omitted sequence track', () => {
	const base = createSoundscaperProject({ id: 'omitted', title: 'Omitted', tracks: [createAudioTrack({ id: 'voice', name: 'Delivered' }),
		createAudioTrack({ id: 'other', name: 'Other sequence' })], primarySequenceId: 'first', sequences: [
		{ id: 'first', name: 'First', trackNodes: [{ kind: 'track', id: 'voice', parentFolderId: null }] },
		{ id: 'second', name: 'Second', trackNodes: [{ kind: 'track', id: 'other', parentFolderId: null }] },
	] });
	const output = base.mixer.outputs.find(candidate => candidate.role === 'main'); assert.ok(output);
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges: base.mixer.edges.map(edge =>
		edge.source.kind === 'track' && edge.source.id === 'other' ? { ...edge, destination: { kind: 'output', id: output.id } } : edge) } });
	const exported = createDawprojectExport({ project });
	const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
	assert.equal(document.tracks.length, 2); assert.equal(document.tracks.find(track => track.name === 'Master')?.channel?.role, 'master');
	assert.equal(exported.report.items.some(item => item.code === 'dawproject.master-output-converted'), false);
});

test('DAWproject never redirects an explicit nonprogramme Master output into the programme', () => {
	const base = createSoundscaperProject({ id: 'master-cue', title: 'Master cue', tracks: [
		createAudioTrack({ id: 'voice', name: 'Ordinary' }), createAudioTrack({ id: 'bypass', name: 'Bypass' }),
	] });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		outputs: [...base.mixer.outputs, { id: 'cue', name: 'Cue', role: 'cue', channelCount: 2 }],
		edges: base.mixer.edges.map(edge => edge.source.kind === 'master' ? { ...edge, destination: { kind: 'output', id: 'cue' } }
			: edge.source.id === 'bypass' ? { ...edge, destination: { kind: 'output', id: 'main' } } : edge),
	} });
	const exported = createDawprojectExport({ project });
	const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
	const master = document.tracks.find(track => track.name === 'Master')?.channel; assert.ok(master);
	const sink = document.tracks.find(track => track.channel?.id === master.destination)?.channel; assert.ok(sink);
	assert.equal(sink.mute?.value, true, 'Master audio assigned only to cue must remain outside the programme');
	assert.ok(exported.report.items.some(item => item.code === 'dawproject.routing-features-omitted'));
});

for (const disabled of [false, true]) test(`DAWproject preserves a ${disabled ? 'disabled' : 'missing'} Master output alongside an audible send`, () => {
	const base = createSoundscaperProject({ id: 'master-detached', title: 'Detached Master', tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })] });
	const wet = { id: 'wet', name: 'Wet', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, sends: [wet], edges: [
		...base.mixer.edges.flatMap(edge => edge.source.kind !== 'master' ? [edge] : disabled ? [{ ...edge, enabled: false }] : []),
		{ id: 'voice-wet', kind: 'send', source: { kind: 'track', id: 'voice' }, destination: { kind: 'mixer-node', id: wet.id },
			position: 'post-fader', level: .4, enabled: true, channelMap: [0, 1] },
		{ id: 'wet-main', kind: 'assignment', source: { kind: 'mixer-node', id: wet.id }, destination: { kind: 'output', id: 'main' },
			position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
	] } });
	const exported = createDawprojectExport({ project });
	const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
	const master = document.tracks.find(track => track.name === 'Master')?.channel; assert.ok(master);
	const sink = document.tracks.find(track => track.channel?.id === master.destination)?.channel; assert.ok(sink);
	assert.equal(sink.mute?.value, true, 'an absent Master connection cannot gain a dry programme path');
	assert.equal(document.tracks.find(track => track.name === 'Voice')?.channel?.sends[0]?.volume?.value, .4);
});
