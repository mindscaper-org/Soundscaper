/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createTrackDuplicationService } from '../src/common/editor/controller/document/internal/track-duplication-service.ts';
import { createAddTrackCommand, createAddClipCommand } from '../src/common/editor/commands/factories.ts';

test('duplicating a video track rebinds its animated effect targets to the copied effect', () => {
	const source = createVideoSource({ id: 'source', storageKey: 'source', mimeType: 'video/mp4',
		contentSha256: 'a'.repeat(64), sampleFrameCount: 48000, sourceFrameCount: 10,
		frameRate: { num: 10, den: 1 }, width: 1920, height: 1080 });
	let project = createFramescaperProject(PROFILE, { sampleRate: 48000, sources: [source],
		tracks: [createVideoTrack({ id: 'track', clipIds: ['clip'] })],
		sequences: [{ id: 'sequence', rate: { num: 10, den: 1 }, trackIds: ['track'] }], primarySequenceId: 'sequence',
		clips: [{ kind: 'video', id: 'clip', sourceId: source.id, sequenceId: 'sequence', sequenceStartFrame: 0,
			sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
			videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			videoEffects: [createVideoEffect('color-adjust', { id: 'color' })],
		}] });
	const original = project.clips[0]!;
	assert.equal(original.kind, 'video');
	if (original.kind !== 'video') assert.fail('Expected video.');
	project = applyFramescaperProjectCommand(PROFILE, project, { type: 'video-keyframes/set', clipId: 'clip',
		expectedKeyframes: original.videoKeyframes,
		keyframes: { schemaVersion: 1, timeDomain: { authoredDuration: { num: 10, den: 1 },
				viewStart: { num: 0, den: 1 }, viewDuration: { num: 10, den: 1 } },
				curves: [{ target: { kind: 'video-effect', effectId: 'color', parameterId: 'brightness' },
					curve: { anchors: [{ position: { num: 0, den: 1 }, value: 0 },
						{ position: { num: 10, den: 1 }, value: 0.5 }], segments: [{ kind: 'linear' }] } }] },
	});
	let sequence = 0;
	const service = createTrackDuplicationService({ lifetime: { assertActive() {} }, editingBlocked: () => false,
		copySuffix: 'copy', getProject: () => project, createId: prefix => `${prefix}-${++sequence}`,
		findClip: (value, id) => value.clips.find(clip => clip.id === id) ?? null,
		cloneVideoEffects: effects => effects.map(effect => ({ ...structuredClone(effect), id: `video-effect-${++sequence}` })),
		createAddTrackCommand, createAddClipCommand,
		commit: command => { project = applyFramescaperProjectCommand(PROFILE, project, command); } });
	service.duplicateTrack(project.tracks[0]!);
	assert.equal(project.clips.length, 2);
	const copy = project.clips.find(clip => clip.id !== 'clip')!;
	assert.equal(copy.kind, 'video');
	if (copy.kind !== 'video') assert.fail('Expected the duplicated video.');
	const frames = copy.videoKeyframes as { curves: { target: { effectId: string } }[] };
	assert.equal(frames.curves[0]?.target.effectId, copy.videoEffects[0]?.id);
	assert.notEqual(copy.videoEffects[0]?.id, 'color');
});
