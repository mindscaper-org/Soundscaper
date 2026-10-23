/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { bindSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
const samples = Float32Array.of(0.25, -0.25, 0.5, -0.5);
for (const name of [null, { damaged: true }, '   ', 'Voice.wav'] as const) {
	test(`P3-008: File Recover retains verified audio with descriptive name ${JSON.stringify(name)}`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		const source = createAudioSource({ id: 'verified-recording', name: 'Voice.wav', sampleRate: 48_000, frameCount: samples.length, channelCount: 1 });
		const clip = createAudioClip({ id: 'voice', sourceId: source.id, durationFrames: samples.length, sourceDurationFrames: samples.length });
		const original = createSoundscaperProject({ id: 'source-name-recovery', sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'voice-track', clipIds: [clip.id] })] });
		await store.writeAudioBuffer(source.storageKey, { sampleRate: source.sampleRate, numberOfChannels: 1,
			length: samples.length, getChannelData: (_channel: number) => samples,
		}, source);
		await store.saveProject(original);
		const stored = structuredClone(original) as unknown as Record<string, unknown>;
		assert.ok(Array.isArray(stored.sources));
		const storedSource: unknown = stored.sources[0]; assert.ok(record(storedSource)); storedSource.name = name;
		store.memory.projects.set(original.id, stored);
		const recovery = bindSoundscaperProjectRecovery(store, project => controller.actions.project.open(project), controller);
		const inspection = await recovery.inspect(original.id);
		const result = await recovery.recover(inspection, 0);
		assert.equal(validateSoundscaperProject(result.project), true);
		assert.equal(controller.project?.id, result.project.id);
		assert.equal(controller.getSnapshot().readOnly, false);
		assert.deepEqual(result.project.clips, original.clips, 'verified recordings remain on their authored timeline');
		assert.deepEqual(result.project.sources, [{ ...source, name: name === 'Voice.wav' ? name : source.id }],
			'only the invalid descriptive name changes; physical identity and geometry remain exact');
		const recovered: number[] = [];
		for await (const chunk of store.readSourceChunks(source.storageKey)) recovered.push(...chunk.channels[0]!);
		assert.deepEqual(recovered, [...samples]);
		assert.deepEqual(store.memory.projects.get(original.id), stored, 'the damaged saved row remains unchanged');
		assert.equal(inspection.candidates[0]?.status, name === 'Voice.wav' ? 'usable' : 'repairable');
		if (name !== 'Voice.wav') assert.ok(result.changes.some(({ path }) => path === 'sources[0].name'));
	});
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
