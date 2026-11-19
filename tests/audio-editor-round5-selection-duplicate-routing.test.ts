/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import {
	COPY, createAudioEditorController, createMemoryEngine, createProjectStore,
} from './helpers/audio-editor-controller-harness.js';

for (const selectionKind of ['headers', 'range'] as const) {
	test(`Edit Duplicate preserves outgoing routes for ${selectionKind} in one history entry`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const projectRuntime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, {
			headless: true, locale: 'en', copy: COPY, projectRuntime,
			sessionController: projectRuntime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round5-duplicate-${selectionKind}` }),
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.generators.generate('tone', {
			amplitude: 0.4, channelCount: 2, durationSeconds: 0.1, frequency: 440,
		});
		const selected = controller.getSnapshot();
		assert.ok(selected.selectedTrackId);
		assert.ok(selected.selectedClipId);
		const trackId = selected.selectedTrackId;
		const groupId = controller.actions.mixer.addBus('group');
		const sendId = controller.actions.mixer.addBus('send');
		controller.actions.mixer.setRoute(trackId, { groupId, sends: { [String(sendId)]: 0.5 } });
		if (selectionKind === 'headers') controller.actions.timeline.selectClip(selected.selectedClipId);
		else controller.actions.timeline.setSelection(480, 3840, { trackIds: [trackId] });
		const original = controller.getSnapshot().project!;
		const before = original.mixer as unknown as MixerGraphV21;
		controller.actions.edit.duplicate();
		const duplicated = controller.getSnapshot();
		assert.ok(duplicated.selectedTrackId);
		assert.notEqual(duplicated.selectedTrackId, trackId);
		const after = duplicated.project!.mixer as unknown as MixerGraphV21;
		const describeRoutes = (graph: MixerGraphV21, id: string) => graph.edges
			.filter(edge => edge.source.kind === 'track' && edge.source.id === id)
			.map(({ kind, destination, position, level, enabled, channelMap }) => (
				{ kind, destination, position, level, enabled, channelMap }
			));
		assert.deepEqual(describeRoutes(after, duplicated.selectedTrackId), describeRoutes(before, trackId));
		assert.deepEqual(describeRoutes(after, trackId), describeRoutes(before, trackId));
		assert.equal(new Set(after.edges.map(edge => edge.id)).size, after.edges.length);
		controller.actions.edit.undo();
		assert.deepEqual(controller.getSnapshot().project!.tracks, original.tracks);
		assert.deepEqual(controller.getSnapshot().project!.clips, original.clips);
		assert.deepEqual(controller.getSnapshot().project!.mixer, before);
		controller.actions.edit.redo();
		assert.deepEqual(controller.getSnapshot().project!.mixer, after);
	});
}

test('Edit Duplicate does not create an extra sequence marker while copying an audio track', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { durationSeconds: .2, frequency: 440 });
	const { selectedTrackId } = controller.getSnapshot();
	assert.ok(selectedTrackId);
	controller.actions.transport.seek(4_000);
	controller.actions.timelineAnnotations.createMarkerAtPlayhead({ name: 'Cue' });
	controller.actions.timeline.setExactSelection(0, 8_000, { trackIds: [selectedTrackId] });
	const annotations = controller.project?.timelineAnnotations;
	assert.equal(annotations?.length, 1);
	controller.actions.edit.duplicate();
	assert.equal(controller.project?.clips.length, 2);
	assert.deepEqual(controller.project?.timelineAnnotations, annotations);
});

for (const anchor of ['sample', 'musical'] as const) test(`Paste at the project start retains overlapping ${anchor} annotation and audio`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { durationSeconds: 1, frequency: 440 });
	const { selectedTrackId } = controller.getSnapshot();
	assert.ok(selectedTrackId);
	controller.actions.timeline.setExactSelection(12_000, 36_000, { trackIds: [selectedTrackId] });
	controller.actions.timelineAnnotations.createRegionFromSelection({ name: 'Verse', anchor });
	controller.actions.timeline.setExactSelection(24_000, 36_000, { trackIds: [selectedTrackId] });
	controller.actions.edit.copy();
	controller.actions.transport.seek(0);
	await controller.actions.edit.paste();
	const regions = controller.getSnapshot().timelineAnnotations;
	assert.deepEqual(regions.map(region => [region.timelineStartFrame, region.timelineEndFrame]), [[0, 12_000], [12_000, 36_000]],
		controller.getSnapshot().status.message);
	assert.ok(controller.project?.clips.some(clip => clip.timelineStartFrame === 0
		&& clip.durationFrames === 12_000 && clip.sourceStartFrame === 24_000));
});
