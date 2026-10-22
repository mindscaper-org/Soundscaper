/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdmChna, createRiffAxmlChunk, createRiffChnaChunk } from '../src/common/editor/adm-metadata.ts';
import { createImportedAdmPassthroughMetadata } from '../src/common/editor/controller/import/internal/wav-import-metadata.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { bindSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
const encoding = { format: 'bw64', bitDepth: 24, dither: 'none' };

for (const editedCopy of [false, true]) test(`NP002: File Recover preserves ${editedCopy ? 'stale' : 'pristine'} imported ADM revision authority`, async context => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const project = await importedProject(String(editedCopy));
	const source = project.sources[0]; assert.ok(source);
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([Float32Array.of(-0.2, 0, 0.2)]); await writer.commit();
	await controller.actions.project.open(project);
	if (editedCopy) {
		await controller.actions.project.duplicate('Edited library copy');
		await controller.actions.project.rename('Changed after copying');
	}
	await controller.actions.project.save();
	const origin = controller.project; assert.ok(origin);
	if (editedCopy) assert.throws(() => createExportPlan(origin, encoding), /project-revision-changed/u);
	else assert.equal(createExportPlan(origin, encoding).adm?.mode, 'passthrough');
	const recovery = bindSoundscaperProjectRecovery(store, recovered => controller.actions.project.open(recovered), controller);
	const inspection = await recovery.inspect(origin.id);
	const index = inspection.candidates.findIndex(candidate => candidate.kind === 'current'); assert.ok(index >= 0);
	const result = await recovery.recover(inspection, index);
	assert.equal(controller.project?.id, result.project.id);
	if (editedCopy) assert.throws(() => createExportPlan(result.project, encoding), /project-revision-changed/u);
	else assert.equal(createExportPlan(result.project, encoding).adm?.mode, 'passthrough');
	assert.deepEqual(await store.loadProject(origin.id), origin);
});

async function importedProject(suffix: string) {
	const bytes = encodeWav([Float32Array.of(-0.2, 0, 0.2)], { container: 'bw64', sampleRate: 48_000, bitDepth: 24, dither: 'none',
		preDataChunks: createRiffChnaChunk(createAdmChna({ layout: 'mono' })),
		trailingChunks: createRiffAxmlChunk({ programmeName: 'Pristine programme', layout: 'mono' }) });
	const descriptor = await inspectWavBlobPcm(new Blob([Uint8Array.from(bytes)]));
	assert.equal(descriptor.adm?.valid, true);
	const source = createAudioSource({ id: `recovery-adm-source-${suffix}`, mimeType: 'audio/wav', sampleRate: 48_000,
		frameCount: 3, channelCount: 1, sampleFormat: 'int24' });
	const adm = createImportedAdmPassthroughMetadata({ candidate: descriptor.adm, descriptor, source, project: { revision: 0 } });
	return createSoundscaperProject({ id: `recovery-adm-${suffix}`, revision: 1, masterChannels: 1, sources: [source],
		clips: [createAudioClip({ id: 'take', sourceId: source.id, durationFrames: 3, sourceDurationFrames: 3 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['take'] })], metadata: { adm } });
}
