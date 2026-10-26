/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipPropertyService } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { renderClipNormalizationAudio } from '../src/common/editor/controller/clip-video/internal/clip-normalization-render.ts';
import type { ClipSourcePreviewResources } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

for (const channels of [1, 6]) test(`nonresident ${channels}channel normalization measures its rendered clip without materializing the original`, async () => {
	const source = { id: 'source', frameCount: 1_920_000, channelCount: channels, sampleRate: 48_000 };
	const clip = { id: 'clip', sourceId: source.id, kind: 'audio' as const, timelineStartFrame: 0,
		sourceStartFrame: 24_000, sourceDurationFrames: 48_000, durationFrames: 48_000,
		gain: .1, pitchCents: 0, speedRatio: 1, renderCacheRevision: 0 };
	const project: ClipTransformProject = { id: 'streamed-normalize',
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, title: 'Streamed normalize', sampleRate: 48_000,
		clips: [clip], sources: [source], tracks: [{ id: 'track', name: 'Track', type: 'audio', clipIds: [clip.id] }] };
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	let renders = 0, disposals = 0;
	const commits: AudioEditorCommand[] = [];
	const providers = new Map([[source.id, { ...source, chunkFrames: 65_536,
		async readStorageChunk() { return Array.from({ length: channels }, () => new Float32Array(65_536).fill(.5)); } }]]);
	const resources: Pick<ClipSourcePreviewResources, 'prepare' | 'createEngine' | 'sourceChunkProviders'> = {
		sourceChunkProviders: providers, async prepare() {},
		createEngine() { return {
			async getAudioContext() { throw new Error('The original recording must stay in bounded storage chunks'); },
			loadProject(preview, buffers, options) {
				assert.ok(buffers instanceof Map); assert.equal(buffers.size, 0);
				assert.equal(options?.chunkSources, providers); assert.equal(preview.masterChannels, channels);
			},
			async renderMix(options: Readonly<{ endFrame?: number }>) {
				renders++; assert.equal(options.endFrame, clip.durationFrames);
				return { channels: Array.from({ length: channels }, () => new Float32Array(clip.durationFrames).fill(.5)) };
			}, async play() {}, pause() {}, stop() {}, seek: frame => frame, setLoop() {}, setPlayRange() {},
			subscribePosition: () => () => {}, dispose() { disposals++; },
		}; },
	};
	const service = createClipPropertyService({ lifetime, sourceBuffers: new Map(),
		copy: { audioClipNotFound: '', clipPitchRange: '', clipSpeedPositive: '', timelineFramesFinite: '' },
		getProject: () => project, getSelectedClipId: () => clip.id, editingBlocked: () => false,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		async loadSourceBuffer() { throw new Error('The original recording must not enter the scalar StaffPad loader'); },
		renderNormalizationAudio: (actual, target, buffer, signal) => renderClipNormalizationAudio(resources, actual, target, buffer, signal),
		async analyzeChannels(actual, sampleRate) {
			assert.equal(actual.length, channels); assert.equal(sampleRate, 48_000);
			for (const channel of actual) { assert.equal(channel.length, clip.durationFrames); assert.equal(channel[100], .5); }
			return { peakAmplitude: .5, integratedLufs: -20 };
		}, createId: prefix => prefix, commit(command) { commits.push(command); },
	});
	await service.handleClipAction('normalize-peak');
	assert.equal(renders, 1); assert.equal(disposals, 1);
	const command = commits[0]; assert.ok(command?.type === 'clip/update');
	assert.equal(command.changes.gain, 10 ** (-1 / 20) / .5);
});
