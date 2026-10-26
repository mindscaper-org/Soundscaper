/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderClipNormalizationAudio } from '../src/common/editor/controller/clip-video/internal/clip-normalization-render.ts';
import type { ClipSourcePreviewResources } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';

function fixture(prepare: () => Promise<void> = async () => {}) {
	const clip = { id: 'pitched', sourceId: 'source', kind: 'audio' as const, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 512, durationFrames: 512, pitchCents: 1200, speedRatio: 1 };
	const project: ClipTransformProject = { id: 'normalize', schemaVersion: 23, title: 'Normalize', sampleRate: 48_000,
		clips: [clip], tracks: [], sources: [{ id: 'source', frameCount: 512, channelCount: 1, sampleRate: 48_000 }] };
	const buffer = { length: 512, sampleRate: 48_000, numberOfChannels: 1,
		getChannelData: () => new Float32Array(512).fill(.5) };
	let prepared = false, engines = 0, disposals = 0;
	const resources: Pick<ClipSourcePreviewResources, 'createEngine' | 'sourceChunkProviders' | 'prepare'> = {
		sourceChunkProviders: new Map(),
		async prepare(actual, signal, options) {
			assert.equal(actual, project); assert.deepEqual(options, { clipIds: [clip.id] }); signal.throwIfAborted();
			await prepare(); signal.throwIfAborted(); prepared = true;
		},
		createEngine() {
			engines++;
			return { loadProject() {}, async renderMix() {
				assert.ok(prepared, 'normalization must measure committed processing before choosing permanent gain');
				return { channels: [new Float32Array(512).fill(.25)] };
			}, async play() {}, pause() {}, stop() {}, seek: frame => frame, setLoop() {}, setPlayRange() {},
				subscribePosition: () => () => {}, dispose() { disposals++; } };
		},
	};
	return { project, clip, buffer, resources, counts: () => ({ engines, disposals }) };
}

test('clip normalization prepares only its transformed target before measuring authored PCM', async () => {
	const f = fixture();
	const output = await renderClipNormalizationAudio(f.resources, f.project, f.clip, f.buffer, new AbortController().signal);
	assert.equal(output.getChannelData(0)[0], .25);
	assert.deepEqual(f.counts(), { engines: 1, disposals: 1 });
});

test('canceled normalization preparation cannot allocate a late measurement engine', async () => {
	let finish = () => {};
	const held = new Promise<void>(resolve => { finish = resolve; });
	const f = fixture(() => held), abort = new AbortController();
	const result = renderClipNormalizationAudio(f.resources, f.project, f.clip, f.buffer, abort.signal);
	const rejected = assert.rejects(result, { name: 'AbortError' });
	abort.abort(); finish(); await rejected;
	assert.deepEqual(f.counts(), { engines: 0, disposals: 0 });
});

test('failed committed processing leaves gain measurement and native allocation untouched', async () => {
	const error = new Error('Unavailable committed transform');
	const f = fixture(async () => { throw error; });
	await assert.rejects(renderClipNormalizationAudio(f.resources, f.project, f.clip, f.buffer, new AbortController().signal), error);
	assert.deepEqual(f.counts(), { engines: 0, disposals: 0 });
});
