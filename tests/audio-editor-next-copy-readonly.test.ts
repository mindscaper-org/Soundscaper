/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createEditorEditService } from '../src/common/editor/controller/edit/internal/edit-service.ts';
import { evaluateAudacityActionEnablement } from '../src/common/editor/audacity-action-parity.js';
import { createMemoryFfmpeg, storedChannelSample } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('a supported project that loses its write lock can copy audio into a new project', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	let lose = (): void => {};
	const lost = new Promise<void>(resolve => { lose = resolve; });
	let lockedProject = '';
	let hasLost = false;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		acquireProjectLock: async projectId => {
			if (!lockedProject) lockedProject = projectId;
			return { projectId, readOnly: hasLost && projectId === lockedProject, method: 'test',
				...(projectId === lockedProject && !hasLost ? { lost } : {}), retryAt: Date.now() + 60_000, release() {} };
		} });
	context.after(async () => { lose(); await controller.dispose(); });
	await controller.ready;
	const samples = new Float32Array(4_800).fill(0.25);
	const wav = encodeWav([samples], { sampleRate: 48_000, bitDepth: 32, float: true, dither: false });
	await controller.actions.project.importFiles([new File([new Uint8Array(wav)], 'Copy source.wav')], { destination: 'timeline' });
	const importedClip = controller.project?.clips[0]; assert.ok(importedClip);
	const importedSample = await storedChannelSample(store, importedClip.sourceId, 0, 10);
	assert.ok(Math.abs(importedSample - 0.25) < 1e-6);
	controller.actions.timeline.selectAll();
	await controller.actions.project.flush();
	hasLost = true; lose();
	for (let attempt = 0; attempt < 100 && !controller.getSnapshot().readOnly; attempt++) {
		await new Promise<void>(resolve => setImmediate(resolve));
	}
	assert.equal(controller.getSnapshot().readOnly, true);
	const original = controller.project;
	assert.ok(original?.clips.length);
	controller.actions.edit.copy();
	assert.equal(controller.getSnapshot().history.hasClipboard, true, 'copying requires read access, not a project write lock');
	assert.equal(controller.project, original, 'Copy cannot change the read-only document or its revision');
	controller.actions.edit.delete();
	assert.equal(controller.project, original, 'persistent editing stays refused');
	await controller.actions.project.create({ title: 'Copied material' });
	assert.equal(controller.getSnapshot().readOnly, false);
	await controller.actions.edit.paste();
	assert.equal(controller.project?.clips.length, 1);
	const clip = controller.project.clips[0]; assert.ok(clip);
	assert.equal(clip.durationFrames, samples.length);
	assert.equal(await storedChannelSample(store, clip.sourceId, 0, 10), importedSample);
});

test('Copy preserves the owning runtime busy and capture admission guards', () => {
	let copies = 0;
	let busy = true;
	const handle = createEditorEditService({ state: { history: {}, readOnly: true },
		editingBlocked: (allowReadOnly = false) => busy || !allowReadOnly,
		handleSelectedLabelClipboard: () => { copies++; return true; } });
	handle('copy');
	assert.equal(copies, 0);
	busy = false;
	handle('copy');
	assert.equal(copies, 1);
	handle('cut');
	assert.equal(copies, 1);
});

test('selected labels can be copied from a read-only project while mutation and busy copying stay refused', () => {
	const snapshot = { project: {}, readOnly: true, selectedLabels: [{ trackId: 'track', labelId: 'label' }] };
	assert.equal(evaluateAudacityActionEnablement('action://copy', { snapshot }), true);
	assert.equal(evaluateAudacityActionEnablement('action://cut', { snapshot }), false);
	assert.equal(evaluateAudacityActionEnablement('action://copy', { snapshot: { ...snapshot, importing: true } }), false);
});
