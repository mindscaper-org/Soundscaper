/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { prepareExactClipEffectResultCommands } from '../src/common/editor/controller/effects/internal/effect-result-clip-commands.ts';

for (const factor of [1, 2]) test(`a selection effect consumes its baked warp at output ratio ${String(factor)}`, () => {
	const clip = createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 100, sourceDurationFrames: 100,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' }, { outer: 25, source: 50, mode: 'forward' },
			{ outer: 100, source: 100, mode: 'forward' },
		] } });
	const project = createSoundscaperProject({ id: 'rendered-warp',
		sources: [createAudioSource({ id: 'source', frameCount: 100, channelCount: 1, sampleRate: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })], clips: [clip] });
	const before = structuredClone(project);
	const frameCount = 100 * factor;
	const commands = prepareExactClipEffectResultCommands(project,
		[{ target: { clipId: 'clip' }, frameCount }], () => createAudioSource({ id: 'processed', frameCount, channelCount: 1, sampleRate: 48_000 }));
	const after = applySoundscaperProjectCommand(project, { type: 'batch', commands });
	const rendered = after.clips[0]; assert.ok(rendered);
	assert.equal(rendered.warpMap, null, 'the replacement PCM already contains the authored time traversal');
	assert.equal(resolveRuntimeClipProjection(after, rendered).durationFrames, frameCount);
	assert.deepEqual(project, before, 'the authored warp survives in the immutable undo snapshot');
});
