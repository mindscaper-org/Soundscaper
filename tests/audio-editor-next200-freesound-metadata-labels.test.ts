/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFreesoundUploadMetadataDefaults } from '../src/common/editor/freesound-upload-metadata.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

for (const [key, label] of [['constructor', 'Constructor'], ['toString', 'ToString'], ['artist', 'Artist']] as const) {
	test(`imported ${key} metadata retains its authored label in a Freesound clip description`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		const pcm = Float32Array.from({ length: 4800 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000));
		const wav = encodeWav([pcm], { sampleRate: 48_000, float: true, metadata: { [key]: 'Ada' } });
		await controller.actions.project.importFiles([new File([Uint8Array.from(wav)], 'Credits.wav', { type: 'audio/wav' })]);
		const source = controller.project?.sources[0]; assert.ok(source);
		const provenance = normalizeSourceProvenance(source.provenance);
		const defaults = createFreesoundUploadMetadataDefaults({ fileName: 'Credits.wav', source: { ...source, provenance } });
		assert.ok(defaults.description.split('\n').includes(`${label}: Ada`), defaults.description);
		assert.doesNotMatch(defaults.description, /\[native code\]|function Object/u);
		assert.equal(source.frameCount, pcm.length);
		await controller.actions.project.save();
	});
}
