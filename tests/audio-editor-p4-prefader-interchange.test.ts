/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../src/common/editor/project-media-factory.ts';
import { exportProjectFcpxml, exportProjectOtio } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

const cases = [
	...(['track', 'bus', 'vca'] as const).flatMap(owner => (['pre-fader', 'post-fader'] as const)
		.map(position => ({ owner, position, mode: 'ordinary', audible: position === 'pre-fader' }))),
	...(['disabled-pre', 'silent-pre', 'muted-destination', 'vca-destination', 'solo-destination', 'cue-output'] as const)
		.map(mode => ({ owner: 'track' as const, position: 'pre-fader' as const, mode, audible: false })),
];

for (const [format, action] of [['otio', exportProjectOtio], ['fcpxml', exportProjectFcpxml]] as const) {
	for (const { owner, position, mode, audible } of cases) {
		test(`${format} keeps a ${position} send from a muted ${owner} only when it reaches programme: ${mode}`, async context => {
			const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
			const base = createSoundscaperProject({ id: 'muted-send', title: 'Muted send', sources: [source],
				tracks: [createAudioTrack({ id: 'voice', name: 'Voice', mute: owner === 'track', clipIds: ['clip'] }),
					...(mode === 'solo-destination' ? [createAudioTrack({ id: 'unrelated', name: 'Unrelated solo', solo: true, clipIds: [] })] : [])],
				clips: [createAudioClip({ id: 'clip', title: 'Audible send', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })] });
			const wet = { id: 'wet', name: 'Wet', color: '#456789', gain: 1, pan: 0, mute: mode === 'muted-destination', solo: false,
				collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
			const bus = { ...wet, id: 'bus', name: 'Bus', mute: true };
			const from = owner === 'bus' ? { kind: 'mixer-node' as const, id: bus.id } : { kind: 'track' as const, id: 'voice' };
			const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, groups: owner === 'bus' ? [bus] : [], sends: [wet],
				vcas: owner === 'vca' || mode === 'vca-destination' ? [{ id: 'vca', name: 'VCA', gain: 1, mute: true,
					members: [mode === 'vca-destination' ? { kind: 'mixer-node', id: wet.id } : { kind: 'track', id: 'voice' }] }] : [],
				outputs: mode === 'cue-output' ? [...base.mixer.outputs, { id: 'cue', name: 'Cue', role: 'cue', channelCount: 2 }] : base.mixer.outputs,
				edges: [...base.mixer.edges.map(edge => owner === 'bus' && edge.source.kind === 'track'
					? { ...edge, destination: { kind: 'mixer-node' as const, id: bus.id } } : edge),
					...(owner === 'bus' ? [{ id: 'bus-dry', kind: 'assignment', source: from, destination: { kind: 'master' },
						position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }] : []),
					{ id: 'send', kind: 'send', source: from, destination: { kind: 'mixer-node', id: wet.id }, position, level: .4,
						enabled: mode !== 'disabled-pre', channelMap: mode === 'silent-pre' ? [-1, -1] : [0, 1] },
					...(['disabled-pre', 'silent-pre'].includes(mode) ? [{ id: 'parallel-post', kind: 'send', source: from,
						destination: { kind: 'mixer-node', id: wet.id }, position: 'post-fader', level: .4, enabled: true, channelMap: [0, 1] }] : []),
					{ id: 'wet-master', kind: 'assignment', source: { kind: 'mixer-node', id: wet.id },
						destination: mode === 'cue-output' ? { kind: 'output', id: 'cue' } : { kind: 'master' },
						position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }],
			} });
			const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
			const incoming = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
			context.after(async () => { await store.close(); await incoming.close(); });
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)]); await writer.commit();
			const native = createSoundscaperScapeNativeRuntime(); const archive = await native.exportScapeProject(project, store); assert.ok(archive.blob);
			const opened = await native.importScapeProject(new File([archive.blob], 'Muted.sscape'), incoming); assert.equal(opened.readOnly, false);
			const before = structuredClone(opened.project), files: Blob[] = [];
			const exported = await action({ getProject: () => opened.project, state: {}, fileService: { saveFile(request) { assert.ok(request.blob instanceof Blob); files.push(request.blob); } } });
			assert.ok(exported); assert.equal(files.length, 1); assert.equal(await files[0]!.text(), exported.text);
			const clips = format === 'otio' ? (exported.text.match(/"OTIO_SCHEMA": "Clip.1"/gu) ?? []).length
				: (exported.text.match(/<asset-clip /gu) ?? []).length;
			assert.equal(clips, audible ? 1 : 0, 'the tap before mute/VCA still needs an open downstream path into the programme');
			assert.deepEqual(opened.project, before);
		});
	}
}
