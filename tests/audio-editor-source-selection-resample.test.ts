/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import type { EffectSelectionProject } from '../src/common/editor/controller/effects/effect-selection-service.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { resampledClipCommands } from '../src/common/editor/controller/track-audio/internal/clip-resample-service.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { commitSourceFormatRewrite } from '../src/common/editor/controller/track-audio/internal/source-selection-format-commit.ts';

test('a source editor selection keeps its material when a clip is resampled', () => {
	const source = createAudioSource({ id: 'original', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const replacement = createAudioSource({ id: 'replacement', sampleRate: 24_000, frameCount: 24_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: 48_000, durationFrames: 48_000 });
	let authored = createAudioEditorProjectV17({ sampleRate: 48_000, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const project = (): EffectSelectionProject => {
		const current = authored.clips[0]!;
		assert.ok(current.kind === 'audio');
		return { ...authored, tracks: authored.tracks.map(track => ({ ...track })),
			clips: [{ ...current, timelineStartFrame: 0, durationFrames: 48_000 }] };
	};
	const service = createSourceEditorEffects({ getProject: project,
		loadSourceBuffer: async () => null, publishDocumentSnapshot: () => undefined });
	service.setSourceSelection({ clipId: clip.id, startFrame: 24_000, endFrame: 48_000 });
	const original = authored;
	const rewrite = { clipIds: [clip.id], previousSourceId: source.id, sourceId: replacement.id,
		frameCount: replacement.frameCount, numerator: replacement.sampleRate, denominator: source.sampleRate };
	assert.throws(() => commitSourceFormatRewrite(service.stageSourceSelectionClockRewrite, [rewrite], () => {
		throw new Error('Publication refused');
	}), /Publication refused/u);
	assert.deepEqual(service.readSourceSelection(), { clipId: clip.id, startFrame: 24_000, endFrame: 48_000 });
	commitSourceFormatRewrite(service.stageSourceSelectionClockRewrite, [rewrite], () => { authored = applyEditorCommand(authored, { type: 'batch', commands: [
		{ type: 'source/add', source: { ...replacement } },
		...resampledClipCommands('track', { ...clip, timelineStartFrame: 0, durationFrames: 48_000 },
			{ ...source }, { ...replacement }, 24_000),
	] }); });
	assert.deepEqual(service.readSourceSelection(), { clipId: clip.id, startFrame: 12_000, endFrame: 24_000 });
	assert.equal(service.readSourceSelectionDuration(), 0.5);
	const resampled = authored;
	authored = original;
	assert.deepEqual(service.readSourceSelection(), { clipId: clip.id, startFrame: 24_000, endFrame: 48_000 });
	authored = resampled;
	assert.deepEqual(service.readSourceSelection(), { clipId: clip.id, startFrame: 12_000, endFrame: 24_000 });
});
