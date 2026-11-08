/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { evaluateNyquist, loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { silentSelectedLaneFixture } from './helpers/silent-selected-lane-fixture.ts';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import type { SelectionEffectResult } from '../src/common/editor/controller/effects/internal/effect-result-service.ts';
import { freezeNyquistResult, normalizeNyquistRole, nyquistMaximumOutputFrames, nyquistAudioResultBytes, nyquistResultStatus } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { createController, createFixture as createControllerFixture } from './helpers/audio-editor-nyquist-controller-harness.js';
import { throwIfAborted } from '../src/common/editor/controller/shared/app-helpers.ts';

for (const scenario of ['ordinary', 'empty-peer', 'real-zero'] as const) test(`a length-changing Nyquist process retains quiet material with ${scenario}`, async () => {
	const f = await fixture();
	const { rate, project, lifetime } = f;
	if (scenario !== 'ordinary') {
		project.tracks.unshift({ ...project.tracks[0]!, id: 'empty', clipIds: [] });
		project.selection = { ...project.selection, trackIds: ['empty', ...project.selection.trackIds ?? []] };
	}
	if (scenario === 'real-zero') {
		project.sources = [...project.sources, { ...project.sources[0]!, id: 'zero-source', storageKey: 'zero-source' }];
		project.tracks.push({ ...project.tracks[0]!, id: 'zero', clipIds: ['zero-clip'] });
		project.clips.push({ ...project.clips[0]!, id: 'zero-clip', sourceId: 'zero-source', timelineStartFrame: 0 });
		project.selection = { ...project.selection, trackIds: [...project.selection.trackIds ?? [], 'zero'] };
	}
	try {
		await f.service.runNyquistEvaluation({ source: '(let ((track *track*)) (seq (cue track) (cue track)))', role: 'prompt' });
		const processed = f.processed();
		assert.equal(processed[0]?.channels[0]?.length, rate * 2, 'the real pinned Nyquist evaluator doubles this input');
		assert.deepEqual(processed.map(result => result.target.track.id), scenario === 'real-zero' ? ['first', 'later', 'zero'] : ['first', 'later']);
		assert.ok(processed.every(result => result.channels[0]!.length === rate * 2));
		if (scenario === 'real-zero') assert.ok(processed.find(result => result.target.track.id === 'zero')?.channels[0]?.every(sample => sample === 0),
			'actual zero-valued audio remains a processing input');
	} finally { lifetime.beginDisposal(); lifetime.finishDisposal(); }
});

test('a sole empty selected lane remains a valid Nyquist Prompt audio destination', async () => {
	const f = await fixture();
	f.project.tracks.splice(0, f.project.tracks.length, { ...f.project.tracks[0]!, id: 'empty', clipIds: [] });
	f.project.clips.length = 0;
	f.project.selection = { ...f.project.selection, trackIds: ['empty'] };
	try {
		await f.service.runNyquistEvaluation({ source: '(osc 60 0.1)', role: 'prompt' });
		assert.deepEqual(f.processed().map(result => result.target.track.id), ['empty']);
		assert.ok(f.processed()[0]?.channels[0]?.some(sample => Math.abs(sample) > .01));
	} finally { f.lifetime.beginDisposal(); f.lifetime.finishDisposal(); }
});

test('processing with an empty peer preserves later-material ripple alignment and Undo/Redo', async context => {
	const rate = 8000, first = new Float32Array(rate).fill(.2), later = new Float32Array(rate).fill(.3), zero = new Float32Array(rate);
	const { store } = await createControllerFixture('nyquist-empty-process-ripple', { sampleRate: rate,
		tracks: [{ id: 'first', name: 'First', input: first }, { id: 'later', name: 'Later', input: later },
			{ id: 'zero', name: 'Digital zero', input: zero }] });
	const wasm = await loadNyquistWasm(await readFile(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	const controller = createController(store, new Map([['first', first], ['later', later], ['zero', zero]]),
		(request: Parameters<typeof wasm.evaluate>[0]) => Promise.resolve(wasm.evaluate(request)));
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const empty = controller.actions.track.add({ name: 'Empty' }); assert.ok(empty);
	await controller.actions.edit.commit({ type: 'clip/move', clipId: 'later-clip', timelineStartFrame: rate * 3 });
	controller.actions.timeline.selectTrack('first');
	controller.actions.timeline.setSelection(0, rate, { trackIds: [empty, 'first', 'later', 'zero'], clipIds: [] });
	await controller.actions.nyquist.evaluate({ source: '(let ((track *track*)) (seq (cue track) (cue track)))', role: 'process' });
	assert.deepEqual(controller.project?.tracks.find(track => track.id === empty)?.clipIds, []);
	assert.equal(controller.project?.clips.find(clip => clip.id === 'later-clip')?.timelineStartFrame, rate * 4);
	await controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips.map(clip => clip.id).sort(), ['first-clip', 'later-clip', 'zero-clip']);
	assert.equal(controller.project?.clips.find(clip => clip.id === 'later-clip')?.timelineStartFrame, rate * 3);
	await controller.actions.edit.redo();
	assert.deepEqual(controller.project?.tracks.find(track => track.id === empty)?.clipIds, []);
	assert.equal(controller.project?.clips.find(clip => clip.id === 'later-clip')?.timelineStartFrame, rate * 4);
});

async function fixture() {
	const fixture = silentSelectedLaneFixture();
	const { rate, project, lifetime, generation, state, copy, selection } = fixture;
	const wasm = await loadNyquistWasm(await readFile(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	let processed: readonly SelectionEffectResult[] = [];
	const service = createSelectionEffectExecutionService({ lifetime,
		state: { ...state, nyquistAbort: null, nyquistResult: null }, copy,
		captureProject: () => generation.capture(), assertProject: (token: Parameters<typeof generation.assertCurrent>[0]) => generation.assertCurrent(token),
		getProject: () => project, activeSelection: () => project.selection, editingBlocked: () => false,
		audacityEffectTargets: selection.audacityEffectTargets,
		audacityEffectSelectionDetails: selection.audacityEffectSelectionDetails,
		projectSampleRate: () => rate, projectDurationFrames: () => rate * 4,
		normalizeNyquistRole, nyquistMaximumOutputFrames, nyquistAudioResultBytes, nyquistResultStatus, freezeNyquistResult, throwIfAborted,
		NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES: 32 * 1024 ** 2, updateTaskProgress() {},
		cancelAudacityEffectPreview() {}, setStatus() {}, publishDocumentSnapshot() {},
		nyquistHostProperties: () => ({}),
		nyquistEvaluator: async (request: Readonly<{ source: string; channels: readonly Float32Array[]; sampleRate: number }>) => evaluateNyquist(request, wasm),
		renderDryTrackRange: async (id: string) => [new Float32Array(rate).fill(id === 'first' ? .25 : 0)],
		preflightStorage: async () => undefined,
		persistAudacityEffectResults: async (results: readonly SelectionEffectResult[]) => { processed = results; },
		audacityEffectMemoryError: () => new Error('Too large'),
	});
	return { ...fixture, service, processed: () => processed };
}
