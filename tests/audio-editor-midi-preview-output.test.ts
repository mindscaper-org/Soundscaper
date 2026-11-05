/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { previewMidiNote } from '../src/common/editor/controller/track-audio/midi-preview.ts';
import { MidiPreviewContext, midiPreviewEngine } from './helpers/midi-preview-context.ts';
import { deferred, waitFor } from './helpers/async-test-control.ts';

test('piano-key auditions respect the listening volume shared with ordinary playback', async () => {
	const context = new MidiPreviewContext();
	const engine = midiPreviewEngine(context);
	try {
		engine.setPlaybackGain(0);
		const preview = previewMidiNote(engine, 69, 'sine');
		await waitFor(() => context.bufferSources.length === 1, 'audition source');
		assert.strictEqual(context.bufferSources[0]!.connections[0], engine.getPlaybackDestination());
		assert.equal((engine.getPlaybackDestination() as GainNode).gain.value, 0);
		context.endVoices(); await preview;
	} finally { await engine.dispose(); }
});

test('canceling pending audition readiness prevents late allocation and start', async () => {
	const context = new MidiPreviewContext(), engine = midiPreviewEngine(context);
	const entered = deferred<void>(), ready = deferred<void>(), abort = new AbortController();
	context.resume = async () => { entered.resolve(); await ready.promise; context.state = 'running'; };
	try {
		const preview = previewMidiNote(engine, 60, 'triangle', abort.signal);
		const outcome = Promise.allSettled([preview]); await entered.promise;
		abort.abort(); ready.resolve();
		assert.equal((await outcome)[0]?.status, 'rejected');
		assert.equal(context.bufferSources.length, 0);
		assert.notEqual(context.state, 'closed', 'the engine owns its context');
	} finally { ready.resolve(); await engine.dispose(); }
});

test('canceling an active audition retires only its voice and listening connection', async () => {
	const context = new MidiPreviewContext(), engine = midiPreviewEngine(context), abort = new AbortController();
	try {
		const preview = previewMidiNote(engine, 60, 'triangle', abort.signal);
		const outcome = Promise.allSettled([preview]);
		await waitFor(() => context.bufferSources.length === 1, 'active audition');
		const voice = context.bufferSources[0]!;
		assert.ok(voice.buffer?.getChannelData(0).some((sample: number) => sample !== 0));
		abort.abort(); assert.equal((await outcome)[0]?.status, 'rejected');
		assert.equal(voice.stopped, true); assert.equal(voice.disconnected, true);
		assert.notEqual(context.state, 'closed');
	} finally { await engine.dispose(); }
});

test('an audition that ends normally releases its abort listener and voice', async () => {
	const context = new MidiPreviewContext(), engine = midiPreviewEngine(context), abort = new AbortController();
	try {
		const preview = previewMidiNote(engine, 60, 'sine', abort.signal);
		await waitFor(() => context.bufferSources.length === 1, 'audition source');
		const voice = context.bufferSources[0]!;
		context.endVoices(); await preview; abort.abort();
		assert.equal(voice.disconnected, true); assert.notEqual(voice.stopped, true);
		assert.equal(voice.onended, null);
	} finally { await engine.dispose(); }
});
