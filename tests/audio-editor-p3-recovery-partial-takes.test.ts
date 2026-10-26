/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { bindSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createCycleProducedTakeFixture } from './helpers/cycle-produced-take-fixture.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const unavailable of ['a', 'b', 'both', 'neither'] as const) {
	test(`P3-004: File Recover retains healthy cycle-recorded takes (${unavailable} unavailable)`, async context => {
		const cycle = await createCycleProducedTakeFixture();
		context.after(async () => { await cycle.store.close(); });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const controller = createAudioEditorController(null, {
			headless: true, locale: 'en', copy: COPY, store, projectRuntime: runtime,
			sessionController: runtime.createSessionController(),
			engine: { ...createMemoryEngine(), getPlaybackGain: () => 1 } as unknown as Options['engine'],
			engineFactory: (() => ({ ...createMemoryEngine(), setPlaybackGain() {} })) as unknown as Options['engineFactory'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		const document = cycle.project;
		const original = createSoundscaperProject({ id: document.id, sampleRate: document.sampleRate,
			sources: document.sources, tracks: document.tracks, sequences: document.sequences,
			primarySequenceId: document.primarySequenceId, takeGroups: document.takeGroups,
		});
		const healthy = cycle.pcm.filter(({ source }) => unavailable === 'neither'
			|| (unavailable !== 'both' && !source.id.endsWith(`-${unavailable}`)));
		for (const { source, channels } of healthy) {
			await store.writeAudioBuffer(source.id, { sampleRate: source.sampleRate, numberOfChannels: channels.length,
				length: source.frameCount, getChannelData: (channel: number) => Float32Array.from(channels[channel]!),
			}, source);
		}
		await store.saveProject(original);
		const recovery = bindSoundscaperProjectRecovery(store, project => controller.actions.project.open(project), controller);
		const inspection = await recovery.inspect(original.id);
		const restored = await recovery.recover(inspection, 0);
		assert.equal(controller.project?.id, restored.project.id);
		assert.notEqual(restored.project.id, original.id);
		assert.equal(controller.getSnapshot().readOnly, false);
		assert.equal(validateSoundscaperProject(restored.project), true);
		assert.equal(restored.project.takeGroups.length, healthy.length > 0 ? 1 : 0);
		const group = restored.project.takeGroups[0];
		assert.deepEqual(group?.takes.map(take => take.sourceId) ?? [], healthy.map(({ source }) => source.id));
		if (group) {
			assert.deepEqual(group.laneOrder, group.lanes.map(lane => lane.id));
			assert.equal(group.compRegions.length, unavailable === 'a' ? 0 : 1);
			for (const take of group.takes) {
				await controller.actions.takeComp.auditionTake(group.id, take.id);
				controller.actions.takeComp.stopAudition();
			}
		}
		for (const { source, channels } of healthy) {
			const pcm: number[] = [];
			for await (const chunk of store.readSourceChunks(source.id)) pcm.push(...chunk.channels[0]!);
			assert.deepEqual(pcm, channels[0]);
		}
		assert.deepEqual(await store.loadProject(original.id), original, 'Recovery must preserve the damaged saved document.');
		assert.equal(inspection.candidates[0]?.status, unavailable === 'neither' ? 'usable' : 'repairable');
	});
}
