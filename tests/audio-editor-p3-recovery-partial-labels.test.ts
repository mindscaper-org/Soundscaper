/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { bindSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const anchor of ['sample', 'musical'] as const) for (const damaged of [false, true]) {
	test(`P3-007: File Recover isolates a malformed ${anchor} label (${damaged})`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		const original = createSoundscaperProject({ id: 'partial-label-recovery', tracks: [{ id: 'labels', name: 'Cues', type: 'label',
			labels: ['before', 'damaged', 'after'].map((id, index) => ({ id, title: id, anchor,
				...(anchor === 'sample' ? { startFrame: index * 48_000, endFrame: index * 48_000 + 24_000 }
					: { startBeat: { num: index * 2, den: 1 }, endBeat: { num: index * 2 + 1, den: 1 } }),
			})),
		}] });
		await store.saveProject(original);
		const labels: unknown = original.tracks[0]?.labels; assert.ok(Array.isArray(labels));
		const sourceLabels = labels as unknown[];
		const stored = structuredClone(original) as unknown as Record<string, unknown>;
		const tracks: unknown = stored.tracks; assert.ok(Array.isArray(tracks));
		const track: unknown = tracks[0]; assert.ok(record(track));
		if (damaged) track.labels = sourceLabels.map((label, index) => {
			assert.ok(record(label)); return index === 1 ? { ...label, title: null } : label;
		});
		store.memory.projects.set(original.id, stored);
		const recovery = bindSoundscaperProjectRecovery(store, project => controller.actions.project.open(project), controller);
		const inspection = await recovery.inspect(original.id);
		const result = await recovery.recover(inspection, 0);
		assert.equal(controller.project?.id, result.project.id);
		assert.equal(controller.getSnapshot().readOnly, false);
		assert.equal(validateSoundscaperProject(result.project), true);
		assert.deepEqual(result.project.tracks[0]?.labels, sourceLabels.filter((_label, index) => !damaged || index !== 1),
			'healthy label identities, order and exact anchors survive recovery');
		assert.deepEqual(store.memory.projects.get(original.id), stored);
		assert.equal(inspection.candidates[0]?.status, damaged ? 'repairable' : 'usable');
		if (damaged) assert.ok(result.changes.some(({ path }) => path.endsWith('.labels[1]')));
	});
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
