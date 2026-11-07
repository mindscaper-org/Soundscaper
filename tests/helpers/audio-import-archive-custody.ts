/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createAudioEditorFileService } from '../../src/common/editor/file-service.js';
import { normalizeSourceProvenance } from '../../src/common/editor/source-provenance.ts';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import type { SoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createEditorProjectRuntimeSelection } from '../../src/framescaper/editor-project-runtime-selection.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { validateFramescaperProject, type FramescaperProject } from '../../src/framescaper/editor-project.ts';
import { COPY, audioBuffer, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { nativeSidecarFixture } from './framescaper-native-sidecar-fixture.ts';

/** Exercise the actual import and portable archive owners with an independent recipient. */
export async function importAndReopenAudio(context: TestContext, file: File, options: {
	product?: 'soundscaper' | 'framescaper'; desktop?: boolean;
	decoded?: { channels: readonly Float32Array[]; sampleRate: number };
} = {}) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const product = options.product ?? 'soundscaper', profile = FRAMESCAPER_PROJECT_RUNTIME_PROFILE;
	const runtime = product === 'framescaper' ? createEditorProjectRuntimeSelection(profile) : createSoundscaperProjectRuntimeSelection();
	const createStore = () => {
		const settings = { indexedDB: createInstrumentedIndexedDB(), preferOpfs: false };
		return product === 'framescaper' ? createFramescaperProjectStore(profile, settings) : createSoundscaperProjectStore(settings);
	};
	const sender = createStore(), recipient = createStore();
	const native = options.desktop ? await nativeSidecarFixture(file.name, new Uint8Array(await file.arrayBuffer())) : null;
	const service = native ? createAudioEditorFileService({ bridge: native.bridge, fetch: native.fetch }) : null;
	const engine = { ...createMemoryEngine(), ...(options.decoded ? { decodeAudioData: async () => {
		assert.ok(options.decoded);
		return audioBuffer(options.decoded.channels.map(channel => channel.slice()), options.decoded.sampleRate);
	} } : {}) };
	const controller = createAudioEditorController(null, { headless: true, productId: product, locale: 'en', copy: COPY, store: sender,
		projectRuntime: runtime as unknown as Options['projectRuntime'], sessionController: runtime.createSessionController(),
		...(service ? { fileService: service } : {}), engine: engine as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); await recipient.close(); await native?.close(); });
	await controller.ready;
	if (service) {
		const choices = await service.chooseFiles({ purpose: 'audio', multiple: false });
		assert.equal(choices.length, 1); assert.equal(choices[0].readProfile, 'selected-range-v1');
		await service.withReadDescriptors(choices, {}, async (files: readonly File[]) => { await controller.actions.project.importFiles(files); });
		assert.equal(native?.releases.length, 1);
	} else await controller.actions.project.importFiles([file]);
	const project = admit(controller.project);
	assert.equal(project.sources.length, 1); assert.equal(project.clips.length, 1);
	const archive = product === 'framescaper' ? createFramescaperScapeNativeRuntime(profile) : createSoundscaperScapeNativeRuntime();
	const exported = await archive.exportScapeProject(project, sender); assert.ok(exported.blob);
	const reopened = await archive.importScapeProject(exported.blob, recipient); assert.equal(reopened.readOnly, false);
	const restored = admit(reopened.project);
	assert.equal(restored.sources.length, 1); assert.equal(restored.clips.length, 1);
	const source = restored.sources[0]; assert.ok(source?.kind === 'audio');
	const contribution = normalizeSourceProvenance(source.provenance).contributions[0]; assert.ok(contribution);
	assert.ok(contribution.origin?.kind === 'local-file');
	assert.equal(contribution.origin.originalFileName, file.name); assert.equal(contribution.origin.byteLength, file.size);
	const samples = Array.from({ length: source.channelCount }, () => [] as number[]);
	for await (const chunk of recipient.readSourceChunks(source.storageKey)) {
		assert.equal(chunk.channels.length, samples.length);
		for (let channel = 0; channel < samples.length; channel++) samples[channel]!.push(...chunk.channels[channel]!);
	}
	return { project: restored, source, contribution, channels: samples.map(channel => Float32Array.from(channel)) };

	function admit(value: unknown): SoundscaperProject | FramescaperProject {
		if (product === 'framescaper') { assert.ok(validateFramescaperProject(profile, value)); return value; }
		assert.ok(validateSoundscaperProject(value)); return value;
	}
}
