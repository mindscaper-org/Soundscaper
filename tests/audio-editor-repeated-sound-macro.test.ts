/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroScriptHost } from '../src/common/editor/controller/effects/internal/macro/macro-script-host.ts';

test('a macro resolves an explicitly selected input once and passes host-owned PCM to the analyzer', async () => {
	let picked = 0;
	const reference = { name: 'jingle.wav', sampleRate: 1000, channels: [new Float32Array(100).fill(.2)] };
	const host = createMacroScriptHost({ getProject: () => ({ tracks: [], clips: [] }), projectSampleRate: () => 1000,
		runEffectMacro: async () => undefined, runMacroCommand: () => undefined, setExactSelection: () => undefined,
		listSavedMacros: () => [], beginMacroTransaction: () => ({ assertCurrent() {}, commit() {}, rollback() {} }),
		findRepeatedSound: async (options, _signal, audio) => {
			assert.deepEqual(options, { similarityThreshold: .9 });
			assert.deepEqual(audio, reference);
			return { trackId: 'labels', sourceTrackId: 'voice', matches: [] };
		},
	});
	await host.runMacroScript({ name: 'Reference file', resolveAudioInput: async (key, rate) => {
		picked += 1; assert.equal(key, 'jingle'); assert.equal(rate, 1000); return reference;
	}, run: async dispatch => {
		assert.deepEqual(await dispatch('input.audio', ['jingle']), { key: 'jingle', name: 'jingle.wav', sampleRate: 1000, channelCount: 1, frameCount: 100 });
		await dispatch('input.audio', ['jingle']);
		await dispatch('analyze.repeatedSound', [{ similarityThreshold: .9, referenceInput: 'jingle' }]);
	} });
	assert.equal(picked, 1);
});

test('macro analysis returns matches and gap-closing edits run in the same transaction', async () => {
	const events: unknown[] = [];
	const project = { id: 'podcast', tracks: [{ id: 'voice', type: 'audio' }], clips: [],
		selection: { startFrame: 10, endFrame: 20, trackIds: ['voice'] } };
	const host = createMacroScriptHost({ getProject: () => project, projectSampleRate: () => 1000,
		runEffectMacro: async () => undefined, runMacroCommand: () => undefined,
		setExactSelection: (startFrame, endFrame) => { project.selection = { startFrame, endFrame, trackIds: ['voice'] }; },
		listSavedMacros: () => [],
		findRepeatedSound: async (options, signal) => {
			events.push(options); assert.equal(signal?.aborted, false);
			return { trackId: 'labels', sourceTrackId: 'voice', matches: [
				{ startFrame: 10, endFrame: 20, similarity: 1, original: true },
				{ startFrame: 100, endFrame: 110, similarity: .98, original: false },
			] };
		},
		deleteAndCloseGap: () => { events.push({ deleted: { ...project.selection } }); },
		beginMacroTransaction: () => ({ assertCurrent() {}, commit: () => { events.push('commit'); }, rollback: () => { events.push('rollback'); } }),
	});
	await host.runMacroScript({ name: 'Break removal', run: async dispatch => {
		const result = await dispatch('analyze.repeatedSound', [{ similarityThreshold: .95 }]);
		assert.partialDeepStrictEqual(result, { trackId: 'labels', sourceTrackId: 'voice' });
		await dispatch('select.frames', [20, 100, { trackIds: ['voice'] }]);
		await dispatch('edit.deleteAndCloseGap', []);
	} });
	assert.deepEqual(events, [{ similarityThreshold: .95 }, { deleted: { startFrame: 20, endFrame: 100, trackIds: ['voice'] } }, 'commit']);
	await assert.rejects(host.createDispatch()('analyze.repeatedSound', [{ upload: true }]), /Unknown repeated sound option/);
});

test('a project change while analysis dependencies load prevents the analyzer from starting', async () => {
	let current = true, analyses = 0;
	const changed = new Error('The project changed.');
	const host = createMacroScriptHost({ getProject: () => ({ tracks: [], clips: [] }), projectSampleRate: () => 1000,
		runEffectMacro: async () => undefined, runMacroCommand: () => undefined, setExactSelection: () => undefined,
		listSavedMacros: () => [], beginMacroTransaction: () => ({ assertCurrent() {}, commit() {}, rollback() {} }),
		findRepeatedSound: async () => { analyses += 1; return { matches: [] }; },
	});
	const dispatch = host.createDispatch(() => undefined, () => { if (!current) throw changed; });
	const running = dispatch('analyze.repeatedSound', []);
	current = false;
	await assert.rejects(running, changed);
	assert.equal(analyses, 0);
});

test('cancelling a macro aborts its analyzer and rolls back the run', async () => {
	let entered: (() => void) | undefined, rollback = false;
	const ready = new Promise<void>(resolve => { entered = resolve; });
	const host = createMacroScriptHost({ getProject: () => ({ tracks: [], clips: [] }), projectSampleRate: () => 48_000,
		runEffectMacro: async () => undefined, runMacroCommand: () => undefined, setExactSelection: () => undefined,
		listSavedMacros: () => [], beginMacroTransaction: () => ({ assertCurrent() {}, commit() {}, rollback: () => { rollback = true; } }),
		findRepeatedSound: (_options, signal) => new Promise((_resolve, reject) => {
			signal?.addEventListener('abort', () => { reject(signal.reason); }, { once: true }); entered?.();
		}),
	});
	const running = host.runMacroScript({ name: 'Cancelled scan', run: async dispatch => { await dispatch('analyze.repeatedSound', []); } });
	await ready; host.cancelMacroScript();
	await assert.rejects(running, { name: 'AbortError' }); assert.equal(rollback, true);
});
