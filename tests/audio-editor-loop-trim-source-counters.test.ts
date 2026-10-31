/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { clipLoopUpdateFields, readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { createClipTransformService } from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';

for (const grouped of [false, true]) for (const reversed of [false, true]) {
	for (const edge of ['left', 'right'] as const) for (const extending of [false, true]) {
		test(`${grouped ? 'grouped' : 'single'} ${reversed ? 'reversed' : 'forward'} loop ${edge} ${extending ? 'extension' : 'cut'} reconciles source trim counters`, () => {
			const sources = Array.from({ length: grouped ? 2 : 1 }, (_, index) => createAudioSource({
				id: `source-${String(index)}`, sampleRate: 24_000, frameCount: 180, channelCount: 1,
			}));
			const clips = sources.map((source, index) => {
				const clip = { kind: 'audio' as const, id: `clip-${String(index)}`, sourceId: source.id,
					timelineStartFrame: 100, durationFrames: 200, sourceStartFrame: 20, sourceDurationFrames: 100,
					trimStartFrames: 20, trimEndFrames: 60, reversed, groupId: grouped ? 'group' : null };
				return createAudioClip({ ...clip, ...clipLoopUpdateFields(clip, { periodFrames: 200, durationFrames: 600 }) });
			});
			const original = createSoundscaperProject({ id: 'loop-trim-counters', sources, clips,
				tracks: clips.map((clip, index) => createAudioTrack({ id: `track-${String(index)}`, clipIds: [clip.id] })) });
			const runtime = createSoundscaperProjectRuntimeSelection();
			let history = runtime.createHistory(original);
			const service = createClipTransformService({ lifetime: { assertActive() {} },
				copy: { audioClipNotFound: 'Missing clip', track: 'Track', timelineFramesFinite: 'Invalid frame' },
				getProject: () => runtime.projectForCommandConsumers(history.present) as ClipTransformProject,
				getSelectedClipId: () => 'clip-0', editingBlocked: () => false, createId: prefix => `${prefix}-new`,
				snapTimelineFrame: Number, activeSelection: () => null,
				commit: command => { history = runtime.executeCommand(history, command); } });
			const delta = (extending ? 20 : -20) * (edge === 'left' ? -1 : 1);
			service.trimClips('clip-0', edge === 'left' ? { timelineStartFrame: 100 + delta } : { durationFrames: 600 + delta });
			const change = extending ? 10 : -10;
			const changesSourceStart = (edge === 'left') !== reversed;
			for (const clip of history.present.clips) {
				assert.ok(clip.kind === 'audio');
				assert.deepEqual([clip.sourceStartFrame, clip.sourceDurationFrames, clip.trimStartFrames, clip.trimEndFrames],
					[changesSourceStart ? 20 - change : 20, 100 + change,
						changesSourceStart ? 20 - change : 20, changesSourceStart ? 60 : 60 - change]);
				assert.equal(readClipLoop(clip)?.periodFrames, 200 + change * 2);
				assert.equal(clip.timelineStartFrame, 100);
				assert.equal(clip.durationFrames, 600);
			}
			const edited = history.present;
			assert.equal(validateSoundscaperProject(JSON.parse(JSON.stringify(edited))), true);
			history = runtime.undo(history);
			assert.deepEqual(history.present.clips, original.clips);
			history = runtime.redo(history);
			assert.deepEqual(history.present.clips, edited.clips);
		});
	}
}
