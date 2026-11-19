/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderClipNormalizationAudio } from '../src/common/editor/controller/clip-video/internal/clip-normalization-render.ts';
import { clipNormalizationControlProject } from '../src/common/editor/controller/clip-video/internal/clip-normalization-controls.ts';
import type { ClipSourcePreviewResources } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { createEffect } from '../src/common/editor/effects.js';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import type { EngineRenderMixOptions } from '../src/common/editor/engine/public-api.ts';

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

test('normalization control project uses the resolved musical target start instead of its stale alias', () => {
	const target = { id: 'target', sourceId: 'source', kind: 'audio' as const, anchor: 'musical', musicalExtent: 'beat',
		musicalStartBeat: { num: 2, den: 1 }, musicalDurationBeats: { num: 1, den: 1 }, timelineStartFrame: 10,
		sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 1_200, pitchCents: 0, speedRatio: 1,
		effectsActive: true, effects: [createEffect('audacity-auto-duck', { context: { controlTrackId: 'guide' } })] };
	const guide = { id: 'guide-clip', sourceId: 'guide-source', kind: 'audio' as const, anchor: 'sample', timelineStartFrame: 48_000,
		sourceStartFrame: 0, sourceDurationFrames: 24_000, durationFrames: 24_000, pitchCents: 0, speedRatio: 1,
		effectsActive: false, effects: [] };
	const project = { id: 'project', schemaVersion: 23, sampleRate: 48_000,
		tempoMap: { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		clips: [target, guide], tracks: [{ id: 'owner', type: 'audio', clipIds: ['target'] }, { id: 'guide', type: 'audio', clipIds: ['guide-clip'] }],
		sources: [{ id: 'source', frameCount: 96_000, channelCount: 1, sampleRate: 48_000 }, { id: 'guide-source', frameCount: 96_000, channelCount: 1, sampleRate: 48_000 }] } as unknown as ClipTransformProject;
	const measured = { sampleRate: 48_000, sources: project.sources, tracks: [], clips: [{ ...target, anchor: 'sample', musicalStartBeat: null,
		musicalDurationBeats: null, musicalExtent: 'fixedSamples', durationFrames: 24_000, timelineStartFrame: 0 }] } as unknown as EngineProject;
	const controlled = clipNormalizationControlProject(project, target, measured, 1);
	assert.ok(controlled);
	assert.equal(controlled.project.clips?.find(clip => clip.id === target.id)?.timelineStartFrame, 48_000);
});

test('normalization renders musical target ranges from projected geometry', async () => {
	const renderRange = async (withControls: boolean) => {
		const target = { id: 'target', sourceId: 'source', kind: 'audio' as const, anchor: 'musical', musicalExtent: 'beat',
			musicalStartBeat: { num: 2, den: 1 }, musicalDurationBeats: { num: 1, den: 1 }, timelineStartFrame: 10,
			sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 1_200, pitchCents: 0, speedRatio: 1,
			effectsActive: withControls, effects: withControls
				? [createEffect('audacity-auto-duck', { context: { controlTrackId: 'guide' } })] : [] };
		const guide = { id: 'guide-clip', sourceId: 'guide-source', kind: 'audio' as const, anchor: 'sample', timelineStartFrame: 48_000,
			sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000, pitchCents: 0, speedRatio: 1,
			effectsActive: false, effects: [] };
		const project = { id: 'project', schemaVersion: 23, sampleRate: 48_000,
			tempoMap: { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
			clips: [target, guide], tracks: [{ id: 'owner', type: 'audio', clipIds: ['target'] }, { id: 'guide', type: 'audio', clipIds: ['guide-clip'] }],
			sources: [{ id: 'source', frameCount: 96_000, channelCount: 1, sampleRate: 48_000 },
				{ id: 'guide-source', frameCount: 96_000, channelCount: 1, sampleRate: 48_000 }] } as unknown as ClipTransformProject;
		const rendered: EngineRenderMixOptions[] = [];
		const resources = {
			sourceChunkProviders: new Map(),
			async prepare() {},
			createEngine() {
				return {
					loadProject() {},
					async renderMix(options: EngineRenderMixOptions) {
						rendered.push(options);
						return { channels: [new Float32Array(1)] };
					},
					async dispose() {},
				};
			},
		} as unknown as Pick<ClipSourcePreviewResources, 'createEngine' | 'sourceChunkProviders' | 'prepare'>;
		await renderClipNormalizationAudio(resources, project, target, null, new AbortController().signal);
		assert.equal(rendered.length, 1);
		return rendered[0]!;
	};

	const controlled = await renderRange(true);
	assert.deepEqual([controlled.startFrame, controlled.endFrame], [48_000, 72_000]);
	const standalone = await renderRange(false);
	assert.deepEqual([standalone.startFrame, standalone.endFrame], [0, 24_000]);
});
