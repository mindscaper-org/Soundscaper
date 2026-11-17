/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareSubprojectTimePitchSources } from '../src/common/editor/controller/document/internal/subprojects/subproject-time-pitch.ts';
import { ClipTimePitchRenderCacheCoordinator } from '../src/common/editor/clip-time-pitch-cache.js';
import { loadStaffPadWasm, renderStaffPad } from '../src/common/editor/staffpad/runtime.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

test('a cold child transform supplies StaffPad PCM without borrowing the parent playback cache', async context => {
	const audio = createNodeWebAudioEngineFactory(context), store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const sampleRate = 8000, frameCount = 16000;
	const writer = await store.beginSourceWrite('voice', { sampleRate, channelCount: 1 });
	await writer.write([Float32Array.from({ length: frameCount }, (_, frame) => .25 * Math.sin(frame * 2 * Math.PI * 500 / sampleRate))]);
	await writer.commit();
	const project = projectForRuntimeConsumers(createSoundscaperProject({ id: 'child', sampleRate,
		sources: [{ id: 'voice', storageKey: 'voice', sampleRate, channelCount: 1, frameCount }],
		tracks: [{ id: 'audio', type: 'audio', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'voice', durationFrames: frameCount, sourceDurationFrames: frameCount, pitchCents: 1200, linkPitchAndTempo: false }],
	}));
	const wasm = await loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
	const cache = new ClipTimePitchRenderCacheCoordinator({ store, client: {
		async render(request: Parameters<typeof renderStaffPad>[0], options: { signal?: AbortSignal }) {
			const channels = request.channels.map(() => new Float32Array(request.outputFrames));
			await renderStaffPad(request, wasm, { signal: options.signal, onChunk: (planes: readonly Float32Array[], offset: number) => {
				planes.forEach((plane, index) => channels[index]!.set(plane, offset));
			} });
			return { channels };
		},
	} });
	const prepared = await prepareSubprojectTimePitchSources(project, store, undefined, cache);
	try {
		const engine = audio.createEngine();
		engine.setSourceResolver(prepared.resolve);
		engine.loadProject(project, new Map());
		const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: frameCount, includeTail: false }))[0]!;
		let crossings = 0;
		for (let frame = 4001; frame < 8000; frame++) if (pcm[frame - 1]! <= 0 && pcm[frame]! > 0) crossings++;
		assert.ok(Math.abs(crossings * sampleRate / 4000 - 1000) < 5, 'a saved octave edit must sound at 1000 Hz');
	} finally { await prepared.close(); }
});
