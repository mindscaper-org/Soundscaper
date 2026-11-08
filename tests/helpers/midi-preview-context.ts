/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAudioEditorEngine } from '../../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../../src/common/editor/engine/public-api.ts';
import { MockAudioContext, MockChunkStreamClient } from './mock-audio-context.js';

export class MidiPreviewContext extends MockAudioContext {
	createBuffer(...args: Parameters<MockAudioContext['createBuffer']>) {
		const buffer = super.createBuffer(...args);
		return Object.assign(buffer, { copyToChannel: (samples: Float32Array, channel: number) => buffer.getChannelData(channel).set(samples) });
	}
	createBufferSource(): ReturnType<MockAudioContext['createBufferSource']> & { onended: ((event: Event) => unknown) | null } {
		return Object.assign(super.createBufferSource(), { onended: null });
	}
	endVoices(): void {
		for (const source of this.bufferSources) source.onended?.(new Event('ended'));
	}
}

export function midiPreviewEngine(context = new MidiPreviewContext()) {
	// The shared Web Audio double implements the engine's exercised node surface.
	return createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext, chunkStreamClient: new MockChunkStreamClient() });
}
