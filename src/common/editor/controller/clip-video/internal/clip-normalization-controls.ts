/* SPDX-License-Identifier: AGPL-3.0-only */
import { clipEffectControlTrackIds } from '../../../clip-effect-control-tracks.ts';
import { clipTimePitchPlaybackProjection } from '../../../clip-time-pitch-playback-projection.ts';
import { createAudioPreviewProject } from '../../../engine/audio-preview-project.ts';
import type { EngineProject } from '../../../engine/types.ts';
import type { MixerGraphV21 } from '../../../mixer-graph-v21.ts';
import type { ClipTransformClip, ClipTransformProject } from './clip/clip-domain-types.ts';

/** Keep detector clocks and input racks, with only the measured clip audible. */
export function clipNormalizationControlProject(project: ClipTransformProject, clip: ClipTransformClip,
	measured: EngineProject, outputChannels: number) {
	const owner = project.tracks.find(track => track.clipIds?.includes(clip.id));
	if (!owner) return null;
	const seed = { ...project, tracks: project.tracks.map(track => track.id === owner.id ? { ...track, clipIds: [clip.id] } : track) };
	const controls = clipEffectControlTrackIds(seed as unknown as EngineProject, new Set([owner.id]));
	if (!controls.length) return null;
	const controlIds = new Set(controls), clipIds = new Set([clip.id]);
	const tracks = project.tracks.filter(track => controlIds.has(track.id) || track.id === owner.id).map(track => {
		const ids = track.id === owner.id ? [clip.id] : track.clipIds ?? [];
		for (const id of ids) clipIds.add(id);
		return { ...track, clipIds: ids, gain: 1, pan: 0, mute: false, solo: false, effects: [], effectsActive: false, envelope: [] };
	});
	const sourceIds = new Set(project.clips.filter(value => clipIds.has(value.id)).map(value => value.sourceId));
	const sources = project.sources.filter(source => sourceIds.has(source.id));
	const clips = project.clips.filter(value => clipIds.has(value.id)).map(value => value.id === clip.id
		? { ...measured.clips![0]!, timelineStartFrame: clip.timelineStartFrame }
		: clipTimePitchPlaybackProjection(project, value, sources.find(source => source.id === value.sourceId)!));
	const preview = createAudioPreviewProject({ sampleRate: project.sampleRate, masterChannels: outputChannels, sources, clips, tracks });
	const mixer = preview.mixer as MixerGraphV21;
	return { project: { ...preview, tempoMap: measured.tempoMap, mixer: { ...mixer, edges: mixer.edges.map(edge => ({ ...edge,
		level: edge.source.kind === 'track' && edge.source.id !== owner.id ? 0 : edge.level })) } }, clipIds: [...clipIds] };
}
