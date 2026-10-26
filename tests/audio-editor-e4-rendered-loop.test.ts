/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { clipLoopUpdateFields, readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { prepareExactClipEffectResultCommands } from '../src/common/editor/controller/effects/internal/effect-result-clip-commands.ts';

for (const factor of [1, 2]) test(`a rendered selection effect consumes baked repetitions at output ratio ${String(factor)}`, () => {
	const original = { ...createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 100, sourceDurationFrames: 100 }),
		kind: 'audio' as const, timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
		opaqueExtensions: { retained: { value: 'authored' } } };
	const clip = { ...original, ...clipLoopUpdateFields(original, { periodFrames: 100, offsetFrames: 25, durationFrames: 350 }) };
	const project = createSoundscaperProject({ id: 'rendered-loop',
		sources: [createAudioSource({ id: 'source', frameCount: 100, channelCount: 1, sampleRate: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })], clips: [clip] });
	const frameCount = 350 * factor;
	const commands = prepareExactClipEffectResultCommands(project,
		[{ target: { clipId: 'clip' }, frameCount }], () => createAudioSource({ id: 'processed', frameCount, channelCount: 1, sampleRate: 48_000 }));
	const after = applySoundscaperProjectCommand(project, { type: 'batch', commands });
	const rendered = after.clips[0]; assert.ok(rendered);
	assert.equal(readClipLoop(rendered), null, 'the replacement source already contains every repetition');
	assert.equal(resolveRuntimeClipProjection(after, rendered).durationFrames, frameCount);
	assert.deepEqual(rendered.opaqueExtensions, { retained: { value: 'authored' } });
	assert.deepEqual(readClipLoop(project.clips[0]!), { periodFrames: 100, offsetFrames: 25 }, 'the undo snapshot retains authored phase');
});
