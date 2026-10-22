/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createScapeDigest, scapeAudioSourceStream, scapeHex } from '../src/common/editor/scape-archive-media.ts';
import { bindSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

for (const changed of [false, true]) test(`MP58: File Recover verifies ${changed ? 'changed' : 'unchanged'} PCM against its saved digest`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const descriptor = createAudioSource({ id: `digest-recovery-source-${String(changed)}`, frameCount: 8, channelCount: 2, sampleRate: 48_000 });
	await store.writeAudioBuffer(descriptor.storageKey, { sampleRate: 48_000, numberOfChannels: 2, length: 8,
		getChannelData: channel => new Float32Array(8).fill(channel ? -.25 : .5) }, descriptor);
	const digest = createScapeDigest();
	await scapeAudioSourceStream(store, descriptor, digest, () => undefined).pipeTo(new WritableStream<Uint8Array>({ write() {} }));
	const source = { ...descriptor, contentSha256: scapeHex(digest.digest()) };
	const project = createSoundscaperProject({ id: `digest-recovery-${String(changed)}`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['take'] })],
		clips: [createAudioClip({ id: 'take', sourceId: source.id, durationFrames: 8, sourceDurationFrames: 8 })] });
	await store.saveProject(project);
	if (changed) {
		const read = store.readSourceChunks.bind(store);
		store.readSourceChunks = async function* (key, options) {
			for await (const chunk of read(key, options)) {
				if (key !== source.storageKey) { yield chunk; continue; }
				const channels = chunk.channels.map(channel => channel.slice());
				channels[0]![0] = -.5;
				yield { ...chunk, channels };
			}
		};
	}
	const recovery = bindSoundscaperProjectRecovery(store, recovered => controller.actions.project.open(recovered));
	const inspection = await recovery.inspect(project.id);
	const index = inspection.candidates.findIndex(row => row.kind === 'current'); assert.ok(index >= 0);
	assert.equal(inspection.candidates[index]?.status, changed ? 'repairable' : 'usable');
	const restored = await recovery.recover(inspection, index);
	assert.equal(controller.project?.id, restored.project.id);
	assert.equal(restored.project.clips.length, changed ? 0 : 1);
	assert.deepEqual(await store.loadProject(project.id), project, 'the damaged original remains untouched');
});
