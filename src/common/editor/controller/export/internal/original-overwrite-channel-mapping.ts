/* SPDX-License-Identifier: AGPL-3.0-only */

import { activeRackEffects } from '../../../engine/project-effects.ts';
import type { EngineProject } from '../../../engine/types.ts';
import type { MixerGraphV21 } from '../../../mixer-graph-v21.ts';

type OriginalMixProject = EngineProject & Readonly<{ mixer?: MixerGraphV21 }>;

/** Recover the level of mono material carried through the stereo panner and main output. */
export function originalOverwriteChannelMapping(project: OriginalMixProject, mapping: unknown): unknown {
	const { mixer, master, tracks = [], clips = [], sources = [] } = project;
	if (mapping !== 'mono' || project.masterChannels !== 2 || project.metadata?.adm
		|| mixer?.schemaVersion !== 1 || mixer.outputs.length !== 1 || !clips.length) return mapping;
	const main = mixer.outputs[0];
	if (main?.role !== 'main' || main.channelCount !== 2) return mapping;
	const monoSources = new Set(sources.filter(source => source.channelCount === 1).map(source => source.id));
	if (clips.some(clip => !monoSources.has(clip.sourceId))) return mapping;
	const populatedTracks = tracks.filter(track => track.type === 'audio' && track.clipIds?.length);
	// Effects can create an authored stereo pair. Keep its ordinary downmix.
	if ([...clips, ...populatedTracks, master].some(owner => activeRackEffects(owner)
		.some(effect => effect.enabled !== false && effect.bypassed !== true))) return mapping;
	const trackIds = new Set(populatedTracks.map(track => track.id));
	const assignments = mixer.edges.filter(edge => edge.enabled);
	if (!assignments.every(edge => {
		if (edge.kind !== 'assignment' || edge.position !== 'post-fader') return false;
		const [left, right] = edge.channelMap;
		if (edge.source.kind === 'master') return edge.destination.kind === 'output' && edge.destination.id === main.id
			&& edge.channelMap.length === 2 && left === 0 && right === 1;
		return edge.source.kind === 'track' && edge.destination.kind === 'master'
			&& (!trackIds.has(edge.source.id) || (edge.channelMap.length === 2 && left === 0 && right === 0));
	})) return mapping;
	return [[Math.SQRT1_2, Math.SQRT1_2]];
}
