/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../src/common/editor/project-media-factory.ts';
import { exportProjectFcpxml, exportProjectOtio } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

for (const [format, action] of [['otio', exportProjectOtio], ['fcpxml', exportProjectFcpxml]] as const) for (const mode of [
	'unmute', 'during', 'musical', 'bus', 'bus-held', 'bus-unrelated-period', 'held-muted', 'future', 'earlier', 'unrelated', 'solo', 'route-silent', 'vca',
] as const) test(`${format} retains audible native mute automation: ${mode}`, async context => {
	const audible = ['unmute', 'during', 'musical', 'bus'].includes(mode);
	const bus = mode.startsWith('bus');
	const source = createAudioSource({ id: 'recording', name: 'Take.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const base = createSoundscaperProject({ id: 'read-mute', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', mute: !bus, clipIds: ['clip'] }), createAudioTrack({ id: 'unused', name: 'Unused', solo: mode === 'solo', clipIds: mode === 'bus-unrelated-period' ? ['other'] : [] })],
		clips: [createAudioClip({ id: 'clip', title: 'Voice edit', sourceId: source.id, timelineStartFrame: mode === 'earlier' ? 24_000 : 0, durationFrames: 48_000, sourceDurationFrames: 48_000 }), ...(mode === 'bus-unrelated-period' ? [createAudioClip({ id: 'other', title: 'Other edit', sourceId: source.id, timelineStartFrame: 60_000, durationFrames: 48_000, sourceDurationFrames: 48_000 })] : [])] });
	const points = mode === 'musical' ? [{ id: 'first', position: { num: 0, den: 1 }, value: 0 }, { id: 'last', position: { num: 4, den: 1 }, value: 0 }]
		: [{ id: 'first', position: 0, value: ['during', 'held-muted', 'bus-held', 'bus-unrelated-period', 'future'].includes(mode) ? 1 : 0 },
			{ id: 'last', position: mode === 'bus-unrelated-period' ? 60_000 : mode === 'future' ? 96_000 : mode === 'earlier' ? 12_000 : mode === 'during' ? 24_000 : 48_000, value: ['earlier', 'held-muted', 'bus-held'].includes(mode) ? 1 : 0 }];
	const routed = bus ? { ...base.mixer, groups: [{ id: 'bus', name: 'Bus', color: '#808080', gain: 1, pan: 0, mute: true, solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2 }],
		edges: [...base.mixer.edges.filter(edge => edge.source.kind !== 'track' || edge.source.id !== 'voice'),
			{ id: 'voice-to-bus', kind: 'assignment', source: { kind: 'track', id: 'voice' }, destination: { kind: 'mixer-node', id: 'bus' }, position: 'post-fader', level: 1, enabled: true, channelMap: [] },
			{ id: 'bus-to-master', kind: 'assignment', source: { kind: 'mixer-node', id: 'bus' }, destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [] }] } : mode === 'vca' ? { ...base.mixer, vcas: [{ id: 'vca', name: 'VCA', gain: 1, mute: true, members: [{ kind: 'track', id: 'voice' }] }] } : base.mixer;
	const project = createSoundscaperProject({ ...base,
		mixer: mode === 'route-silent' ? { ...base.mixer, edges: base.mixer.edges.map(edge => edge.destination.kind === 'output' ? { ...edge, channelMap: [-1, -1] } : edge) } : routed,
		automationLanes: [{ id: 'mute-ride', address: { kind: 'strip', strip: bus ? { kind: 'mixer-node', id: 'bus' } : { kind: 'track', id: mode === 'unrelated' ? 'unused' : 'voice' }, parameterId: 'mute' },
			timebase: mode === 'musical' ? 'musical-beats' : 'absolute-samples', points, segments: [{ kind: 'hold' }] }] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }); context.after(() => store.close());
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
	const native = createSoundscaperScapeNativeRuntime(); const archive = await native.exportScapeProject(project, store); assert.ok(archive.blob);
	const imported = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:opened` }); context.after(() => imported.close());
	const opened = await native.importScapeProject(new File([archive.blob], 'Mute.sscape'), imported); assert.equal(opened.readOnly, false);
	const before = structuredClone(opened.project); const files: Blob[] = [];
	const result = await action({ getProject: () => opened.project, state: {}, fileService: { saveFile(request) { assert.ok(request.blob instanceof Blob); files.push(request.blob); } } });
	assert.ok(result); assert.equal(files.length, 1); assert.equal(await files[0]?.text(), result.text);
	const count = format === 'otio' ? (result.text.match(/"clipId": "clip"/gu) ?? []).length : (result.text.match(/<asset-clip[^>]*name="Voice edit"/gu) ?? []).length;
	assert.equal(count, audible ? 1 : 0, 'a cut export must retain the source edit whenever its authored mute lane opens during the clip');
	if (audible) assert.ok(result.report.items.some(item => item.code === `${format}.audio-processing-omitted`), 'retained cut still discloses unsupported mute automation');
	assert.deepEqual(opened.project, before);
});
