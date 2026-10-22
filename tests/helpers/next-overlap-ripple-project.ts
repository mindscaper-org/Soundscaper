/* SPDX-License-Identifier: AGPL-3.0-only */
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack, createAudioClip, createAudioSource } from '../../src/common/editor/project-media-factory.ts';
import { normalizeAutomationLaneV21 } from '../../src/common/editor/automation-lane-v21.ts';

export function overlapRippleProject(kind: 'takes' | 'automation') {
	const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'overlap-ripple', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['first', 'second', 'later'] })],
		clips: [
			createAudioClip({ id: 'first', title: 'First', sourceId: source.id, timelineStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000 }),
			createAudioClip({ id: 'second', title: 'Second', sourceId: source.id, timelineStartFrame: 24_000, durationFrames: 48_000, sourceDurationFrames: 48_000 }),
			createAudioClip({ id: 'later', title: 'Later', sourceId: source.id, timelineStartFrame: 144_000, durationFrames: 4_800, sourceDurationFrames: 4_800 }),
		], sequences: [{ id: 'main', trackIds: ['voice'] }], primarySequenceId: 'main',
		...(kind === 'takes' ? { takeGroups: [{ id: 'group', sequenceId: 'main', trackId: 'voice',
			startSample: 144_000, endSample: 148_800, laneOrder: ['lane'], lanes: [{ id: 'lane' }],
			takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample: 144_000, endSample: 148_800, sourceStartSample: 0 }],
			compRegions: [{ id: 'comp', takeId: 'take', startSample: 144_000, endSample: 148_800 }],
		}] } : { automationLanes: [normalizeAutomationLaneV21({ id: 'ride',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' }, timebase: 'absolute-samples',
			points: [{ id: 'start', position: 0, value: 1 }, { id: 'later-gain', position: 144_000, value: .25 }, { id: 'finish', position: 148_800, value: 1 }],
			segments: [{ kind: 'linear' }, { kind: 'linear' }],
		})] }),
	});
	return { project, source };
}
