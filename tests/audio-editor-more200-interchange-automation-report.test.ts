/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../src/common/editor/project-media-factory.ts';
import { exportProjectFcpxml, exportProjectOtio } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

for (const [format, action] of [['otio', exportProjectOtio], ['fcpxml', exportProjectFcpxml]] as const) {
	for (const mode of ['gain', 'pan', 'neutral', 'muted', 'unrelated'] as const) test(`${format} reports current native track automation: ${mode}`, async context => {
		const source = createAudioSource({ id: 'recording', name: 'Take.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
		const project = createSoundscaperProject({ id: 'interchange-automation', sources: [source],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', mute: mode === 'muted', clipIds: ['clip'] }), createAudioTrack({ id: 'unused', name: 'Unused' })],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
			automationLanes: mode === 'neutral' ? [] : [{ id: 'ride', address: { kind: 'strip', strip: { kind: 'track', id: mode === 'unrelated' ? 'unused' : 'voice' }, parameterId: mode === 'pan' ? 'pan' : 'gain' },
				timebase: 'absolute-samples', points: [{ id: 'first', position: 0, value: mode === 'pan' ? 0 : 1 }, { id: 'last', position: 4800, value: .5 }], segments: [{ kind: 'linear' }] }],
		});
		assert.equal(Object.hasOwn(project.tracks[0] ?? {}, 'envelope'), false, 'native strip curves have their own lane authority');
		const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		try {
			const writer = await archiveStore.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
			const native = createSoundscaperScapeNativeRuntime(); const archive = await native.exportScapeProject(project, archiveStore); assert.ok(archive.blob instanceof Blob);
			const opened = await native.importScapeProject(new File([archive.blob], 'Ride.sscape'), store); assert.equal(opened.readOnly, false);
			const original = structuredClone(opened.project); const delivered: Blob[] = [];
			const result = await action({ getProject: () => opened.project, state: {}, fileService: { saveFile(request) { assert.ok(request.blob instanceof Blob); delivered.push(request.blob); } } });
			assert.ok(result); assert.equal(delivered.length, 1); assert.equal(await delivered[0]?.text(), result.text);
			const warnings = result.report.items.filter(item => item.code === `${format}.audio-processing-omitted`);
			if (['neutral', 'muted', 'unrelated'].includes(mode)) assert.equal(warnings.length, 0);
			else {
				const warning = warnings.find(item => item.scope.kind === 'track' && item.scope.id === 'voice'); assert.ok(warning, 'the delivered file must disclose discarded native automation');
				assert.equal(warning.severity, 'warning'); assert.equal(warning.disposition, 'omitted'); assert.deepEqual(warning.data.automationLanes, ['ride']);
			}
			assert.deepEqual(opened.project, original);
		} finally { await archiveStore.close(); await store.close(); }
	});
}
