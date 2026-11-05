/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { COPY, createAudioEditorController, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { MidiPreviewContext, midiPreviewEngine } from './helpers/midi-preview-context.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';
import { MockNode } from './helpers/mock-audio-context.js';
import { createMockAudioWorkletNodeClass } from './helpers/mock-audio-worklet-node.js';

async function fixture(t: TestContext) {
	const previousWorklet = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: createMockAudioWorkletNodeClass(MockNode) });
	t.after(() => {
		if (previousWorklet) Object.defineProperty(globalThis, 'AudioWorkletNode', previousWorklet);
		else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	});
	const context = new MidiPreviewContext(), engine = midiPreviewEngine(context);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: t.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, engine, store });
	t.after(async () => { context.endVoices(); await controller.dispose(); });
	await controller.ready;
	return { context, engine, controller };
}

for (const transition of ['project', 'dispose'] as const) {
	test(`pending piano audition cannot outlive ${transition} replacement`, async t => {
		const f = await fixture(t), entered = deferred<void>(), ready = deferred<void>();
		f.context.resume = async () => { entered.resolve(); await ready.promise; f.context.state = 'running'; };
		t.after(() => { ready.resolve(); });
		const preview = f.controller.actions.midi.previewNote(60, 'sine');
		const outcome = Promise.allSettled([preview]); await entered.promise;
		if (transition === 'project') await f.controller.actions.project.create();
		else await f.controller.dispose();
		ready.resolve(); await outcome; await settle();
		assert.equal(f.context.bufferSources.length, 0);
	});

	test(`active piano audition stops on ${transition} replacement`, async t => {
		const f = await fixture(t);
		const preview = f.controller.actions.midi.previewNote(60, 'sine');
		await waitFor(() => f.context.bufferSources.length === 1, 'piano voice');
		const voice = f.context.bufferSources[0]!;
		if (transition === 'project') await f.controller.actions.project.create();
		else await f.controller.dispose();
		assert.equal(voice.stopped, true); assert.equal(voice.disconnected, true);
		await preview;
	});
}

test('selection and ordinary timeline playback preserve overlapping same-project piano voices', async t => {
	const f = await fixture(t);
	const { clipId } = await f.controller.actions.midi.addTrack();
	const first = f.controller.actions.midi.previewNote(60, 'sine');
	await waitFor(() => f.context.bufferSources.length === 1, 'first voice');
	f.controller.actions.timeline.selectClip(clipId);
	const second = f.controller.actions.midi.previewNote(64, 'triangle');
	await waitFor(() => f.context.bufferSources.length === 2, 'second voice');
	await f.controller.actions.transport.playPause();
	assert.equal(f.engine.getState().state, 'playing');
	for (const voice of f.context.bufferSources.slice(0, 2)) assert.notEqual(voice.stopped, true);
	f.context.endVoices(); await Promise.all([first, second]);
	for (const voice of f.context.bufferSources.slice(0, 2)) assert.equal(voice.disconnected, true);
});

test('a genuine current audition readiness failure remains visible and does not poison the next preview', async t => {
	const f = await fixture(t);
	f.context.resume = async () => { throw new Error('The selected output is unavailable.'); };
	await assert.rejects(f.controller.actions.midi.previewNote(60), /selected output is unavailable/u);
	assert.equal(f.context.bufferSources.length, 0);
	f.context.resume = async () => { f.context.state = 'running'; };
	const healthy = f.controller.actions.midi.previewNote(60);
	await waitFor(() => f.context.bufferSources.length === 1, 'replacement audition');
	f.context.endVoices(); await healthy;
});
