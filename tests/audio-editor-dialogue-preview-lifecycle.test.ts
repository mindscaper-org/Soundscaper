/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { createDialogueAlignmentPreview } from '../src/common/editor/controller/track-audio/internal/dialogue-alignment-preview.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

test('a real dialogue preview survives the initial stopped state while loading its project', async context => {
	const native = createNodeWebAudioEngineFactory(context), lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const preview = createDialogueAlignmentPreview(lifetime, native.createEngine, async () => {}, async audio => {
		const buffer = new AudioBuffer({ numberOfChannels: audio.channels.length, sampleRate: audio.sampleRate, length: audio.channels[0]!.length });
		for (const [index, channel] of audio.channels.entries()) buffer.getChannelData(index).set(channel);
		return buffer as unknown as globalThis.AudioBuffer;
	});
	try {
		await assert.doesNotReject(preview.play({ sampleRate: 48000,
			channels: [Float32Array.from({ length: 48000 }, (_, frame) => .2 * Math.sin(frame * Math.PI / 24))],
		}, () => {}));
	} finally { await preview.stop(); }
});
