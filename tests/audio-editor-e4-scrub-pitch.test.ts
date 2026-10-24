/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { normalizeStaffPadRenderRequest } from '../src/common/editor/staffpad/parameters.js';
import { loadStaffPadWasm, renderStaffPad } from '../src/common/editor/staffpad/runtime.js';
import { createAudioEditorController, createTwoTrackFixture, ENGLISH_COPY } from './helpers/audio-editor-multitrack-selection-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';

test('the public scrub action acquires independent pitch before scheduling its first grain', async context => {
	const rate = 48_000;
	const pcm = Float32Array.from({ length: rate }, (_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * frame / rate));
	const { project, store } = await createTwoTrackFixture('e4-scrub', new Map([['main', pcm]]), rate);
	await store.saveProject(applyEditorCommand(project, { type: 'clip/update', clipId: 'main-clip', changes: { pitchCents: 1200 } }));
	const runtime = await loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
	const device = new MockAudioContext({ sampleRate: rate });
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext, offlineAudioContextFactory: null });
	const renders: string[] = [];
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: ENGLISH_COPY, store, engine,
		ffmpeg: { dispose() {} } as unknown as NonNullable<Parameters<typeof createAudioEditorController>[1]>['ffmpeg'],
		staffPadRenderClient: { async render(request: unknown, options: Readonly<{ signal?: AbortSignal; cacheKey?: string }> = {}) {
			const normalized = normalizeStaffPadRenderRequest(request);
			renders.push(options.cacheKey ?? '');
			const channels = normalized.channels.map(() => new Float32Array(normalized.outputFrames));
			await renderStaffPad(normalized, runtime, { isCancelled: () => options.signal?.aborted === true,
				onChunk(chunk: Float32Array[], offset: number) { for (let channel = 0; channel < channels.length; channel++) channels[channel]!.set(chunk[channel]!, offset); } });
			return { channels, cacheKey: options.cacheKey };
		} } });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	assert.equal(renders.length, 0, 'opening the stopped project has not warmed playback caches');
	await controller.actions.transport.scrub(6000);
	const scheduled = (device.bufferSources as unknown as readonly { readonly buffer: AudioBuffer | null; readonly started?: readonly number[] }[])
		.find(node => node.started && node.buffer);
	assert.ok(scheduled?.buffer);
	const samples = scheduled.buffer.getChannelData(0);
	let crossings = 0;
	for (let frame = 6001; frame < 18000; frame++) if (samples[frame - 1]! < 0 && samples[frame]! >= 0) crossings++;
	assert.ok(Math.abs(crossings * scheduled.buffer.sampleRate / 12000 - 2000) < 8, 'scrub must audition the pitched PCM');
	assert.equal(renders.length, 1);
	controller.actions.transport.endScrub();
});
