/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { RecordingRecoveryJournalRepository, RECORDING_RECOVERY_KEY_PREFIX } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { createRecordingCheckpointWriter } from '../src/common/editor/controller/recording/internal/recording-checkpoint-writer.ts';
import type { RecordingSourceWriter } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const condition of ['healthy', 'narrow-last', 'wide-last', 'narrow-first'] as const) {
	test(`P3-010: interrupted recording verifies its journaled channel layout (${condition})`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const project = createSoundscaperProject({ id: 'checkpoint-channel-recovery', tracks: [createAudioTrack({ id: 'voice' })] });
		await store.saveProject(project);
		const repository = new RecordingRecoveryJournalRepository(store.analysisRepository);
		let journal = await repository.create(project.id, 'capture', project);
		journal = await repository.addLane(journal, 'mic', { trackId: 'voice', startFrame: 0, sourceOffsetFrames: 0, sampleRate: 48_000, selection: null });
		const metadata = { name: 'Mic', channelCount: 2, sampleRate: 48_000 };
		const openWriter = async (id: string): Promise<RecordingSourceWriter> => {
			const physical = await store.beginSourceWrite(id, metadata);
			return { get framesWritten() { return physical.framesWritten; }, write: channels => physical.write(channels),
				async commit(extra = {}) {
					const saved: unknown = await physical.commit(extra);
					assert.ok(record(saved) && typeof saved.name === 'string' && typeof saved.channelCount === 'number');
					return { ...saved, name: saved.name, channelCount: saved.channelCount };
				}, abort: () => physical.abort() };
		};
		const writer = createRecordingCheckpointWriter({ firstSourceId: 'first', initialWriter: await openWriter('first'), metadata,
			checkpointFrames: 4, createSourceId: () => 'last', openWriter,
			onCheckpoint: async segment => { journal = await repository.append(journal, 'mic', segment); } });
		const channels = [Float32Array.of(0.125, 0.25, 0.375, 0.5), Float32Array.of(0.5, 0.375, 0.25, 0.125)];
		await writer.write(channels); await writer.write(channels); await writer.finishRecording?.();
		const corrupted = { ...journal, lanes: journal.lanes.map(lane => ({ ...lane, segments: lane.segments.map((segment, index) => {
			assert.ok(record(segment.metadata));
			return { ...segment, metadata: { ...segment.metadata,
				channelCount: condition === 'healthy' || index !== (condition === 'narrow-first' ? 0 : 1)
					? 2 : condition === 'wide-last' ? 3 : 1 } };
		}) })) };
		await store.saveAnalysis(`${RECORDING_RECOVERY_KEY_PREFIX}${encodeURIComponent(project.id)}`, corrupted);
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.openById(project.id);
		const pending = controller.getSnapshot().takeCycleRecovery; assert.ok(pending);
		if (condition === 'narrow-first') {
			await assert.rejects(controller.actions.recording.cycle.recover(pending), /checkpoint/u);
			assert.deepEqual(await store.loadProject(project.id), project);
			assert.deepEqual(await repository.load(project.id), corrupted);
		} else {
			await controller.actions.recording.cycle.recover(pending);
			const recovered: unknown = controller.project; assert.ok(validateSoundscaperProject(recovered));
			assert.equal(recovered.clips.length, condition === 'healthy' ? 2 : 1, 'only channel-verified recording checkpoints may publish');
			assert.ok(recovered.sources.every(source => source.channelCount === 2));
			assert.equal(await repository.load(project.id), null);
		}
		for (const id of ['first', 'last']) {
			const read: number[][] = [[], []];
			for await (const chunk of store.readSourceChunks(id)) chunk.channels.forEach((channel: Float32Array, index: number) => read[index]!.push(...channel));
			assert.deepEqual(read, channels.map(channel => [...channel]), 'recovery never rewrites the original checkpoint PCM');
		}
	});
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
