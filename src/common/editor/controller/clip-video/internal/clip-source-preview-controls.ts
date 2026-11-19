/* SPDX-License-Identifier: AGPL-3.0-only */
import { clipEffectControlTrackIds } from '../../../clip-effect-control-tracks.ts';
import { clipTimePitchPlaybackProjection } from '../../../clip-time-pitch-playback-projection.ts';
import { clipSourcePreviewWarpMap } from '../../../clip-source-timing.ts';
import { resolveRuntimeClipProjection } from '../../../runtime-clip-projection.ts';
import { createAudioPreviewProject } from '../../../engine/audio-preview-project.ts';
import type { EngineProject } from '../../../engine/types.ts';
import type { MixerGraphV21 } from '../../../mixer-graph-v21.ts';
import { readMidiTrack, withMidiTrackData } from '../../../midi-model.ts';
import type { ClipSourcePreviewProject } from './clip-source-preview-project.ts';

/** Give the source clock a nonnegative engine origin while preserving external input clocks. */
export function withClipSourcePreviewControls(original: ClipSourcePreviewProject, clipId: string, preview: EngineProject): EngineProject {
	const owner = original.tracks?.find(track => track.clipIds?.includes(clipId));
	if (!owner) return preview;
	const seed = { ...original, tracks: original.tracks?.map(track => track.id === owner.id ? { ...track, clipIds: [clipId] } : track) };
	const controls = new Set(clipEffectControlTrackIds(seed as unknown as EngineProject, new Set([String(owner.id)])));
	if (!controls.size) return preview;
	controls.delete(String(owner.id));
	const authored = original.clips.find(clip => clip.id === clipId), measured = preview.clips?.find(clip => clip.id === clipId);
	if (!authored || !measured) throw new ReferenceError('The source audition clip is missing.');
	const playbackProject = { sampleRate: original.sampleRate, tempoMap: original.tempoMap };
	const targetGeometry = resolveRuntimeClipProjection(playbackProject, authored);
	const origin = Math.max(0, targetGeometry.timelineStartFrame - Number(measured.timelineStartFrame));
	const shift = Number(measured.timelineStartFrame) + origin - targetGeometry.timelineStartFrame;
	const guides = original.tracks!.filter(track => controls.has(String(track.id)));
	const ids = new Set(guides.flatMap(track => track.clipIds ?? []));
	const sourceById = new Map(original.sources.map(source => [source.id, source]));
	const guideClips = original.clips.filter(clip => ids.has(clip.id)).map(clip => {
		const source = sourceById.get(clip.sourceId);
		if (!source) throw new ReferenceError('The source audition control media is missing.');
		const projected = clipTimePitchPlaybackProjection(playbackProject, clip, source);
		return { ...projected, anchor: 'sample', musicalStartBeat: null,
			musicalDurationBeats: null, musicalExtent: 'fixedSamples', timelineStartFrame: Number(projected.timelineStartFrame) + shift,
			warpMap: clipSourcePreviewWarpMap(original, clip, source) };
	});
	const sourceIds = new Set(guideClips.map(clip => clip.sourceId));
	const midi = readMidiTrack(owner);
	const listening = (preview.tracks ?? []).map(track => {
		const value = { ...track, id: String(owner.id) };
		return midi ? withMidiTrackData(value, midi) : value;
	});
	const sources = new Map((preview.sources ?? []).map(source => [source.id, source]));
	for (const source of original.sources) if (sourceIds.has(source.id)) sources.set(source.id, source);
	const output = createAudioPreviewProject({ sampleRate: original.sampleRate, masterChannels: Number(preview.masterChannels),
		sources: [...sources.values()], clips: [
			...(preview.clips ?? []).map(clip => ({ ...clip, timelineStartFrame: Number(clip.timelineStartFrame) + origin })), ...guideClips,
		], tracks: [...listening, ...guides.map(track => ({ ...track, gain: 1, pan: 0, mute: false, solo: false,
			effects: [], effectsActive: false, envelope: [] }))],
	});
	const mixer = output.mixer as MixerGraphV21;
	const result = { ...output, tempoMap: original.tempoMap, clipSourcePreviewOriginFrame: origin,
		clipSourcePreviewPreparedClipIds: [clipId, ...ids],
		mixer: { ...mixer, edges: mixer.edges.map(edge => ({ ...edge,
			level: edge.source.kind === 'track' && controls.has(edge.source.id) ? 0 : edge.level })) },
	};
	return result;
}
