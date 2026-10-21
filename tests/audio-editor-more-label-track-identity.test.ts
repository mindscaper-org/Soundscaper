/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MI24: editing a reopened SCAPE does not conflate labels whose IDs are scoped to different tracks', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const source = createSoundscaperProject({ id: 'track-scoped-labels', sampleRate: 48_000,
		tracks: ['first', 'second'].map((id, index) => ({ id, type: 'label', name: id, labels: [
			{ id: 'intro', title: 'Intro', anchor: 'musical', startBeat: { num: index ? 3 : 1, den: index ? 1 : 7 },
				endBeat: { num: index ? 4 : 2, den: index ? 1 : 7 } },
		] })),
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-label-track-identity' });
	const exported = await exportScapeProject(source, store);
	assert.ok(exported.blob instanceof Blob);
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.openScapeFile(new File([exported.blob], 'Labels.scape'), () => 'copy');
	assert.equal(controller.project?.id, source.id);
	const readLabel = (trackId: string) => {
		const track = controller.project?.tracks.find(candidate => candidate.id === trackId); assert.ok(track);
		const labels: unknown = Reflect.get(track, 'labels'); assert.ok(Array.isArray(labels));
		const label: unknown = labels[0]; assert.ok(label && typeof label === 'object');
		return label;
	};
	const first = structuredClone(readLabel('first')), second = structuredClone(readLabel('second'));
	await controller.actions.metadata.update({ artist: 'Updated file metadata' });
	assert.deepEqual(readLabel('first'), first, 'an unrelated menu edit must preserve exact musical beats in the first label track');
	assert.deepEqual(readLabel('second'), second);
	await controller.actions.labels.update('first', 'intro', { title: 'Only first track' });
	assert.deepEqual(readLabel('second'), second, 'updating one track cannot borrow another track label baseline');
});
