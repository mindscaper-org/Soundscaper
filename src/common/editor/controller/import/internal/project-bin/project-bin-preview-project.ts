/* SPDX-License-Identifier: AGPL-3.0-only */
import { clipEffectControlTrackIds } from '../../../../clip-effect-control-tracks.ts';
import { clipTimePitchPlaybackProjection } from '../../../../clip-time-pitch-playback-projection.ts';
import { createAudioPreviewProject } from '../../../../engine/audio-preview-project.ts';
import type { EngineClip, EngineProject, EngineTrack } from '../../../../engine/types.ts';
import type { MixerGraphV21 } from '../../../../mixer-graph-v21.ts';
import { resolveRuntimeClipProjection } from '../../../../runtime-clip-projection.ts';
import type { ProjectBinClip, ProjectBinProject, ProjectBinSource } from '../../project-bin-types.ts';
import { resolveProjectBinAudioPreviewClip } from './project-bin-runtime.ts';

/** Bin clips keep their racks and authored detector clock after leaving a lane. */
export function createProjectBinAudioPreviewProject(project: ProjectBinProject, clip: ProjectBinClip, source: ProjectBinSource, trackId: string) {
	const previewClip = { ...resolveProjectBinAudioPreviewClip(project, clip), id: clip.id, groupId: null, avLinkId: null, binItemId: null };
	const owner = { id: trackId, type: 'audio', clipIds: [clip.id], name: previewClip.title, armed: false };
	const controlIds = new Set(clipEffectControlTrackIds({ clips: [...project.clips, clip] as readonly EngineClip[],
		tracks: [...project.tracks, owner] as readonly EngineTrack[] }, new Set([trackId])));
	const startFrame = controlIds.size ? resolveRuntimeClipProjection(project, clip).timelineStartFrame : 0;
	const guides = project.tracks.filter(track => controlIds.has(track.id));
	const clipIds = new Set(guides.flatMap(track => track.clipIds ?? []));
	const guideClips = project.clips.filter(candidate => clipIds.has(candidate.id)).map(candidate => {
		const input = project.sources.find(value => value.id === candidate.sourceId);
		if (!input) throw new ReferenceError('The Project Bin control media is missing.');
		return { ...resolveProjectBinAudioPreviewClip(project, clipTimePitchPlaybackProjection(project, candidate, input)),
			timelineStartFrame: resolveRuntimeClipProjection(project, candidate).timelineStartFrame };
	});
	const sourceIds = new Set(guideClips.map(candidate => candidate.sourceId));
	const preview = createAudioPreviewProject({ title: 'Project Bin preview', sampleRate: project.sampleRate,
		sources: [source, ...project.sources.filter(candidate => candidate.id !== source.id && sourceIds.has(candidate.id))],
		clips: [{ ...previewClip, timelineStartFrame: startFrame }, ...guideClips],
		tracks: [owner, ...guides.map(track => ({ ...track, gain: 1, pan: 0, mute: false, solo: false,
			effects: [], effectsActive: false, envelope: [] }))],
	});
	const mixer = preview.mixer as MixerGraphV21;
	const output: EngineProject = { ...preview, ...(controlIds.size || previewClip.warpMap != null ? { tempoMap: project.tempoMap } : {}),
		mixer: { ...mixer, edges: mixer.edges.map(edge => ({ ...edge,
			level: edge.source.kind === 'track' && controlIds.has(edge.source.id) ? 0 : edge.level })) } };
	return { project: output, startFrame, endFrame: startFrame + previewClip.durationFrames, clipIds: [clip.id, ...clipIds] };
}
