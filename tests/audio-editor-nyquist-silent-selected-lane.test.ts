/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { evaluateNyquist, loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { silentSelectedLaneFixture } from './helpers/silent-selected-lane-fixture.ts';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import type { SelectionEffectResult } from '../src/common/editor/controller/effects/internal/effect-result-service.ts';
import { freezeNyquistResult, normalizeNyquistRole, nyquistMaximumOutputFrames, nyquistAudioResultBytes, nyquistResultStatus } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';
import { throwIfAborted } from '../src/common/editor/controller/shared/app-helpers.ts';

test('a length-changing Nyquist process runs over every selected lane including an initially silent range', async () => {
	const { rate, project, lifetime, generation, state, copy, selection } = silentSelectedLaneFixture();
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
	try {
		await service.runNyquistEvaluation({ source: '(let ((track *track*)) (seq (cue track) (cue track)))', role: 'prompt' });
		assert.equal(processed[0]?.channels[0]?.length, rate * 2, 'the real pinned Nyquist evaluator doubles this input');
		assert.deepEqual(processed.map(result => result.target.track.id), ['first', 'later']);
		assert.deepEqual(processed.map(result => result.channels[0]!.length), [rate * 2, rate * 2]);
	} finally { lifetime.beginDisposal(); lifetime.finishDisposal(); }
});
