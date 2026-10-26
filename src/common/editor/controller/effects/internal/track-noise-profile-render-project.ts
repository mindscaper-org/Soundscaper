/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from '../../../automation-lane-v21.ts';
import type { MixerGraphV21 } from '../../../mixer-graph-v21.ts';
import { createIsolatedTrackRenderProjectV21, type IsolatedTrackRenderProjectV21 }
	from '../../shared/isolated-track-render-project-v21.ts';
import { projectTransientRenderFeatures } from '../../shared/transient-render-feature-projection.ts';
import type { EffectAudioEffect, EffectAudioProject } from './effect-audio-service-types.ts';

/** Profile the authored rack prefix while excluding its listening strip and later processors. */
export function createTrackNoiseProfileRenderProject(
	project: EffectAudioProject, trackId: string, prefix: readonly EffectAudioEffect[],
): EffectAudioProject {
	const prefixIds = new Set(prefix.map(effect => effect.id));
	const lanes: readonly unknown[] = Array.isArray(project.automationLanes) ? project.automationLanes : [];
	const mixer = project.mixer as unknown as MixerGraphV21;
	// Neutralize only the programme listening strip before taking its detector
	// closure. Other strips may supply an authored detector, including through a
	// bus or another sidechain processor, and keep their processing and lanes.
	const prefixProject = { ...project,
		tracks: project.tracks.map(track => {
			if (track.id !== trackId) return track;
			const neutral = { ...track };
			delete neutral.envelope;
			return { ...neutral, gain: 1, pan: 0, mute: false, solo: false,
				effectsActive: prefix.length > 0, effects: prefix };
		}),
		mixer: { ...mixer, edges: mixer.edges.filter(edge => !(edge.destination.kind === 'effect-sidechain'
			&& edge.destination.strip.kind === 'track' && edge.destination.strip.id === trackId
			&& !prefixIds.has(edge.destination.effectId))) },
		automationLanes: lanes.map(lane => normalizeAutomationLaneV21(lane)).filter(({ address }) =>
			address.kind === 'edge' || address.strip.kind !== 'track' || address.strip.id !== trackId
			|| address.kind === 'effect' && prefixIds.has(address.effectId)),
	};
	const capture = createIsolatedTrackRenderProjectV21(prefixProject as unknown as IsolatedTrackRenderProjectV21,
		{ trackId, effects: prefix, preserveTrackProcessing: true });
	projectTransientRenderFeatures(capture);
	return capture as unknown as EffectAudioProject;
}
