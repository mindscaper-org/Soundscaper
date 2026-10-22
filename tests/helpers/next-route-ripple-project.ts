/* SPDX-License-Identifier: AGPL-3.0-only */
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack, createAudioClip, createAudioSource } from '../../src/common/editor/project-media-factory.ts';
import { normalizeAutomationLaneV21 } from '../../src/common/editor/automation-lane-v21.ts';

export function routeRippleProject() {
	const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const base = createSoundscaperProject({ id: 'route-ripple', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['first', 'later'] }), createAudioTrack({ id: 'other', name: 'Other', clipIds: ['other-clip'] })],
		clips: [
			createAudioClip({ id: 'first', title: 'First', sourceId: source.id, timelineStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000 }),
			createAudioClip({ id: 'later', title: 'Later', sourceId: source.id, timelineStartFrame: 192_000, durationFrames: 48_000, sourceDurationFrames: 48_000 }),
			createAudioClip({ id: 'other-clip', title: 'Other', sourceId: source.id, timelineStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000 }),
		] });
	const assignment = (trackId: string) => {
		const edge = base.mixer.edges.find(candidate => candidate.kind === 'assignment' && candidate.source.kind === 'track' && candidate.source.id === trackId);
		if (!edge) throw new Error('The native fixture needs its authored output assignment.');
		return edge.id;
	};
	const points = (prefix: string) => [{ id: `${prefix}-start`, position: 0, value: 1 }, { id: `${prefix}-later`, position: 192_000, value: .25 }];
	const project = createSoundscaperProject({ ...base, automationLanes: [
		...['voice', 'other'].map(trackId => normalizeAutomationLaneV21({ id: `${trackId}-output`,
			address: { kind: 'edge', edgeId: assignment(trackId), parameterId: 'level' }, timebase: 'absolute-samples',
			points: points(trackId), segments: [{ kind: 'linear' }],
		})),
		normalizeAutomationLaneV21({ id: 'master-gain', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: points('master'), segments: [{ kind: 'linear' }],
		}),
	] });
	return { project, source };
}
