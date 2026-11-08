/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioEditorController, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { deferred } from './helpers/async-test-control.ts';

function rate(snapshot: { readonly audioDevices: unknown }): unknown {
	assert.ok(snapshot.audioDevices && typeof snapshot.audioDevices === 'object');
	return Reflect.get(snapshot.audioDevices, 'recordingSampleRate');
}

test('a superseded native recording rate retires quietly after the latest public request succeeds', async context => {
	const oldClose = deferred<void>();
	let firstContext = true;
	let closing = false;
	const engine = createAudioEditorEngine({ audioContextFactory: (options?: AudioContextOptions) => {
		const audio = new MockAudioContext(options);
		if (firstContext) audio.close = async () => {
			closing = true;
			await oldClose.promise;
			audio.state = 'closed';
		};
		firstContext = false;
		return audio as unknown as EngineAudioContext;
	} });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', projectRuntime: runtime, sessionController: runtime.createSessionController(), engine,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
	});
	context.after(async () => { oldClose.resolve(); await controller.dispose(); });
	await controller.ready;
	await controller.actions.audioDevices.setHostInventory('alsa', {
		backend: 'alsa', status: 'ready', detail: '', devices: [],
	});
	await engine.getAudioContext({ resume: false });
	const older = Promise.allSettled([controller.actions.audioDevices.setRecordingSampleRate(44_100)]);
	assert.equal(closing, true);
	await controller.actions.audioDevices.setRecordingSampleRate(96_000);
		assert.equal(rate(controller.getSnapshot()), 96_000);
	assert.equal((await engine.getAudioContext({ resume: false })).sampleRate, 96_000);
	oldClose.resolve();
	const [outcome] = await older;
	assert.equal(outcome?.status, 'rejected');
	if (outcome?.status === 'rejected') {
		assert.ok(outcome.reason instanceof DOMException);
		assert.equal(outcome.reason.name, 'AbortError', 'obsolete context preparation is expected cancellation');
	}
		assert.equal(rate(controller.getSnapshot()), 96_000);
});

test('a current native recording-rate failure remains visible and preserves the saved rate', async context => {
	const failure = new DOMException('The selected audio rate is unavailable.', 'NotSupportedError');
	const engine = createAudioEditorEngine({ audioContextFactory: (options?: AudioContextOptions) => {
		if (options?.sampleRate === 96_000) throw failure;
		return new MockAudioContext(options) as unknown as EngineAudioContext;
	} });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', projectRuntime: runtime, sessionController: runtime.createSessionController(), engine,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.audioDevices.setHostInventory('alsa', {
		backend: 'alsa', status: 'ready', detail: '', devices: [],
	});
	await assert.rejects(controller.actions.audioDevices.setRecordingSampleRate(96_000), error => error === failure);
		assert.equal(rate(controller.getSnapshot()), 48_000);
});
