/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { AudioBuffer } from 'node-web-audio-api';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand as apply } from '../src/soundscaper/editor-project-commands.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';

for (const scope of ['track', 'clip', 'master'] as const) test(`deleting MIDI control does not break ${scope} pitch correction playback`, async context => {
	const fetch = globalThis.fetch;
	context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, options?: RequestInit) => input instanceof URL && input.protocol === 'file:'
		? new Response(await readFile(input)) : fetch(input, options));
	const effect = createEffect('auto-tune', { id: 'tune', params: { controlTrackId: 'midi' } });
	const original = createSoundscaperProject({ sampleRate: 48000,
		sources: [{ id: 'source', sampleRate: 48000, channelCount: 1, frameCount: 8192 }],
		clips: [{ id: 'voice', sourceId: 'source', durationFrames: 8192, effects: scope === 'clip' ? [effect] : [] }],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['voice'], effects: scope === 'track' ? [effect] : [] }, createMidiTrack({ id: 'midi' })],
		master: { effects: scope === 'master' ? [effect] : [] },
	});
	const project = apply(original, { type: 'track/remove', trackId: 'midi' });
	const engine = createNodeWebAudioEngineFactory(context).createEngine();
	const buffer = new AudioBuffer({ numberOfChannels: 1, length: 8192, sampleRate: 48000 });
	buffer.getChannelData(0).set(Float32Array.from({ length: 8192 }, (_, index) => .25 * Math.sin(2 * Math.PI * 440 * index / 48000)));
	try {
		engine.loadProject(projectForRuntimeConsumers(project), new Map([['source', buffer as unknown as globalThis.AudioBuffer]]));
		const rendered = await engine.renderMix({ startFrame: 0, endFrame: 8192, includeTail: false });
		assert.ok(audioBufferChannels(rendered)[0]!.some(value => Math.abs(value) > .01));
	} finally { await engine.dispose(); }
});
