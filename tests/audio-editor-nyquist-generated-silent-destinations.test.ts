/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createController, createFixture } from './helpers/audio-editor-nyquist-controller-harness.js';

for (const duration of [1, 2]) test(`Pluck${duration}s fills every selected destination and its Undo/Redo includes initially silent lanes`, async context => {
	const rate = 8000, first = new Float32Array(rate).fill(.2), later = new Float32Array(rate).fill(.3);
	const { store } = await createFixture(`nyquist-generate-quiet-selected-lane-${duration}`, { sampleRate: rate,
		tracks: [{ id: 'first', name: 'First', input: first }, { id: 'later', name: 'Later', input: later }] });
	const wasm = await loadNyquistWasm(await readFile(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	const controller = createController(store, new Map([['first', first], ['later', later]]),
		(request: Parameters<typeof wasm.evaluate>[0]) => Promise.resolve(wasm.evaluate(request)));
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.edit.commit({ type: 'clip/move', clipId: 'later-clip', timelineStartFrame: rate * 3 });
	controller.actions.timeline.selectTrack('first');
	controller.actions.timeline.setSelection(0, rate, { trackIds: ['first', 'later'], clipIds: [] });
	const source = await readFile(new URL('../src/common/editor/nyquist/plugins/pluck.ny', import.meta.url), 'utf8');
	const result = await controller.actions.nyquist.evaluate({ source, role: 'generate', name: 'Pluck', controls: { PITCH: 60, FADE: 0, DUR: duration } });
	assert.ok(result && typeof result === 'object' && 'frameCount' in result); assert.equal(result.frameCount, rate * duration);
	const laterOwner = controller.project?.tracks.find(track => track.id === 'later');
	assert.ok(laterOwner && Array.isArray(laterOwner.clipIds));
	assert.equal(laterOwner.clipIds.length, 2, 'selected silent range must receive generated audio alongside the existing later clip');
	assert.equal(controller.project?.clips.find(clip => clip.id === 'later-clip')?.timelineStartFrame, rate * (3 + duration - 1));
	await controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips.map(clip => clip.id).sort(), ['first-clip', 'later-clip']);
	assert.equal(controller.project?.clips.find(clip => clip.id === 'later-clip')?.timelineStartFrame, rate * 3);
	await controller.actions.edit.redo();
	const redone = controller.project?.tracks.find(track => track.id === 'later');
	assert.ok(redone && Array.isArray(redone.clipIds)); assert.equal(redone.clipIds.length, 2);
	assert.equal(controller.project?.clips.find(clip => clip.id === 'later-clip')?.timelineStartFrame, rate * (3 + duration - 1));
});
