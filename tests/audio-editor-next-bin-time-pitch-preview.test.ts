/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { normalizeStaffPadRenderRequest } from '../src/common/editor/staffpad/parameters.js';
import { loadStaffPadWasm, renderStaffPad } from '../src/common/editor/staffpad/runtime.js';
import { createAudioEditorController, createTwoTrackFixture, ENGLISH_COPY } from './helpers/audio-editor-multitrack-selection-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';

interface ScheduledBuffer {
	readonly buffer: AudioBuffer | null;
	readonly started?: readonly number[];
}

for (const mode of ['pitch', 'tempo'] as const) test(`Project Bin ${mode} audition uses its authored processed audio`, async () => {
	const sampleRate = 48_000;
	const frames = sampleRate;
	const pcm = Float32Array.from({ length: frames }, (_, frame) => .2 * Math.sin(2 * Math.PI * 440 * frame / sampleRate));
	const { store } = await createTwoTrackFixture(`next-bin-${mode}`, new Map([['main', pcm], ['other', pcm]]), sampleRate);
	const runtime = await loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
	const contexts: MockAudioContext[] = [];
	const renderedIds: string[] = [];
	let releaseRender: () => void = () => {};
	let renderStarted: () => void = () => {};
	let releaseResume: () => void = () => {};
	let resumeStarted: () => void = () => {};
	const heldRender = new Promise<void>(resolve => { releaseRender = resolve; });
	const firstRenderStarted = new Promise<void>(resolve => { renderStarted = resolve; });
	const heldResume = new Promise<void>(resolve => { releaseResume = resolve; });
	const resumedRenderStarted = new Promise<void>(resolve => { resumeStarted = resolve; });
	const factory: typeof createAudioEditorEngine = (options = {}) => {
		const context = new MockAudioContext({ sampleRate }); contexts.push(context);
		return createAudioEditorEngine({ ...options, audioContextFactory: () => context as unknown as AudioContext,
			offlineAudioContextFactory: null });
	};
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: factory(), engineFactory: factory, ffmpeg: { dispose() {} } as unknown as NonNullable<Parameters<typeof createAudioEditorController>[1]>['ffmpeg'],
		staffPadRenderClient: { async render(request: unknown, options: Readonly<{ signal?: AbortSignal; cacheKey?: string }> = {}) {
			const normalized = normalizeStaffPadRenderRequest(request);
			renderedIds.push(options.cacheKey ?? '');
			if (mode === 'pitch' && renderedIds.length === 1) { renderStarted(); await heldRender; }
			if (mode === 'pitch' && renderedIds.length === 2) { resumeStarted(); await heldResume; }
			const channels = normalized.channels.map(() => new Float32Array(normalized.outputFrames));
			await renderStaffPad(normalized, runtime, { isCancelled: () => options.signal?.aborted === true,
				onChunk(chunk: Float32Array[], offset: number) { for (let channel = 0; channel < channels.length; channel++) channels[channel]!.set(chunk[channel]!, offset); } });
			return { channels, cacheKey: options.cacheKey };
		} },
	});
	try {
		await controller.ready;
		controller.actions.clip.update('other-clip', { pitchCents: 600 });
		controller.actions.projectBin.moveFromTimeline('other-clip');
		controller.actions.clip.update('main-clip', mode === 'pitch' ? { pitchCents: 300 } : { speedRatio: 2 });
		controller.actions.projectBin.moveFromTimeline('main-clip');
		const playing = controller.actions.projectBin.playPause('main-clip');
		if (mode === 'pitch') {
			await firstRenderStarted;
			await controller.actions.projectBin.playPause('main-clip');
			releaseRender();
			await assert.rejects(playing, { name: 'AbortError' });
			assert.ok(contexts.every(context => context.bufferSources.length === 0), 'Pause must retire a pending cache before it can start audio');
			const resuming = controller.actions.projectBin.playPause('main-clip');
			await resumedRenderStarted;
			assert.equal(controller.getSnapshot().projectBinPreview?.state, 'playing', 'a pending resume remains pausable');
			await controller.actions.projectBin.playPause('main-clip');
			releaseResume();
			await assert.rejects(resuming, { name: 'AbortError' });
			assert.ok(contexts.every(context => context.bufferSources.length === 0), 'canceling resume must not start dry or late processed audio');
			await controller.actions.projectBin.playPause('main-clip');
		} else await playing;
		const expectedRenders = mode === 'pitch' ? 3 : 1;
		const scheduled = contexts.flatMap(context => context.bufferSources as unknown as readonly ScheduledBuffer[])
			.find(node => node.started && node.buffer && node.buffer.length === (mode === 'pitch' ? frames : frames / 2));
		assert.ok(scheduled?.buffer, 'the private preview must resolve its exact prepared clip identity');
		const channel = scheduled.buffer.getChannelData(0);
		const frequency = crossingFrequency(channel, sampleRate);
		assert.ok(Math.abs(frequency - (mode === 'pitch' ? 440 * 2 ** (3 / 12) : 440)) < 5,
			`authored ${mode} must retain its intended pitch; got ${frequency}Hz`);
		assert.equal(renderedIds.length, expectedRenders, 'only the chosen bin clip should prepare time/pitch PCM');
		await controller.actions.projectBin.stopPreview();
		await controller.actions.projectBin.playPause('main-clip');
		assert.equal(renderedIds.length, expectedRenders, 'unchanged exact cached audio should be reused');
	} finally { releaseRender(); releaseResume(); await controller.dispose(); }
});

function crossingFrequency(samples: Float32Array, sampleRate: number): number {
	const start = Math.floor(samples.length / 4), end = Math.floor(samples.length * 3 / 4);
	let crossings = 0;
	for (let frame = start + 1; frame < end; frame++) if (samples[frame - 1]! < 0 && samples[frame]! >= 0) crossings++;
	return crossings * sampleRate / (end - start);
}
