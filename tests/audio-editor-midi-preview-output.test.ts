/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { previewMidiNote } from '../src/common/editor/controller/track-audio/midi-preview.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';

test('piano-key auditions respect the listening volume shared with ordinary playback', async () => {
	class PreviewContext extends MockAudioContext {
		createBuffer(...args: Parameters<MockAudioContext['createBuffer']>) {
			const buffer = super.createBuffer(...args);
			return Object.assign(buffer, { copyToChannel: (samples: Float32Array, channel: number) => buffer.getChannelData(channel).set(samples) });
		}
	}
	const context = new PreviewContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext });
	try {
		engine.setPlaybackGain(0);
		await previewMidiNote(engine, 69, 'sine');
		assert.strictEqual(context.bufferSources[0]!.connections[0], engine.getPlaybackDestination());
		assert.equal((engine.getPlaybackDestination() as GainNode).gain.value, 0);
	} finally { await engine.dispose(); }
});
