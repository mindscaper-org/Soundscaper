/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../src/common/editor/project-media-factory.ts';
import { exportProjectFcpxml, exportProjectOtio } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

for (const [format, action] of [['otio', exportProjectOtio], ['fcpxml', exportProjectFcpxml]] as const) {
	for (const mode of ['reverse', 'forward', 'speed', 'reverse-and-speed'] as const) test(`${format} discloses discarded clip playback direction: ${mode}`, async context => {
		const reversed = mode.startsWith('reverse'), speedRatio = mode.includes('speed') ? 2 : 1;
		const source = createAudioSource({ id: 'recording', name: 'Take.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
		const project = createSoundscaperProject({ id: 'interchange-reverse', sources: [source],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800 / speedRatio,
				sourceDurationFrames: 4800, speedRatio, reversed })],
		});
		const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		try {
			const writer = await archiveStore.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
			const native = createSoundscaperScapeNativeRuntime(); const archive = await native.exportScapeProject(project, archiveStore); assert.ok(archive.blob instanceof Blob);
			const opened = await native.importScapeProject(new File([archive.blob], 'Reverse.sscape'), store); assert.equal(opened.readOnly, false);
			const original = structuredClone(opened.project); const delivered: Blob[] = [];
			const result = await action({ getProject: () => opened.project, state: {}, fileService: { saveFile(request) { assert.ok(request.blob instanceof Blob); delivered.push(request.blob); } } });
			assert.ok(result); assert.equal(delivered.length, 1); assert.equal(await delivered[0]?.text(), result.text);
			const warnings = result.report.items.filter(item => item.code === `${format}.speed-change-omitted`);
			if (mode === 'forward') assert.equal(warnings.length, 0);
			else {
				const warning = warnings.find(item => item.scope.kind === 'clip'); assert.ok(warning, 'the delivered file must disclose discarded playback direction');
				assert.equal(warning.severity, 'warning'); assert.equal(warning.disposition, 'omitted');
				assert.equal(warning.data.kind, reversed ? 'reverse' : 'speed');
				if (reversed) { assert.equal(warning.data.reversed, true); assert.match(warning.message, /reversed playback/u); }
				if (speedRatio !== 1) assert.equal(warning.data.speedRatio, speedRatio);
			}
			assert.deepEqual(opened.project, original);
		} finally { await archiveStore.close(); await store.close(); }
	});
}
