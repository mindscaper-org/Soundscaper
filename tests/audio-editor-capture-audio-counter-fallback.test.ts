/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBrowserAudioRecorder } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';

test('a native processor without exact discard counters releases its reader and uses the existing native-format worklet path', async () => {
	let cancelled = 0, released = 0, worklets = 0;
	class Processor {
		readonly readable = { getReader: () => ({
			read: async () => ({ done: true }), cancel: () => { cancelled += 1; }, releaseLock: () => { released += 1; },
		}) };
	}
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', track: { kind: 'audio', getSettings: () => ({ sampleRate: 48_000, channelCount: 2 }) },
		stream: {}, context: { sampleRate: 48_000 }, MediaStreamTrackProcessor: Processor,
		inputGain: 1.5, onChunk() {}, recordingControllerFactory: options => {
			worklets += 1;
			assert.equal(options.channelCount, 2); assert.equal(options.inputGain, 1.5);
			return { start() {}, pause: () => true, resume: () => true, stop() {}, detach() {} };
		},
	});
	await recorder.start(0);
	assert.equal(recorder.backend, 'audio-worklet');
	assert.deepEqual([recorder.sampleRate, recorder.channelCount, worklets, cancelled, released], [48_000, 2, 1, 1, 1]);
	await recorder.stop(); await recorder.dispose();
});
