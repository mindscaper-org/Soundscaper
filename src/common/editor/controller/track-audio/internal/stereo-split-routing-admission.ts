/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import { rackSignalChannelCount } from '../../../effect-signal-width.ts';
import { NOISE_GATE_EFFECT_DEFINITION } from '../../../first-party-effects/standard/noise-gate-definition.ts';
import { defaultMixerChannelMapV21, normalizeMixerGraphV21, type MixerGraphV21 }
	from '../../../mixer-graph-v21.ts';
import { isSoundscaperProductionProject } from '../../../project-schema-version.ts';
import { resolveTerminalChannelWidths } from '../../../terminal-channel-widths.ts';
import type { ControllerClip, ControllerProject, ControllerTrack } from '../track-domain-types.ts';

/** Independent mono racks cannot preserve stereo processing or arbitrary channel maps. */
export function assertStereoSplitRepresentable(
	project: ControllerProject,
	track: ControllerTrack,
	clips: readonly ControllerClip[],
	copy: object,
): void {
	if (rackSignalChannelCount(track, 1) > 1 || clips.some(clip => rackSignalChannelCount(clip, 1) > 1)
		|| hasActiveLinkedNoiseGate(track) || hasStereoClipWithLinkedNoiseGate(project, clips)) {
		throw createLocalizedError(RangeError, copy, 'stereoSplitEffectsRequireRender');
	}
	if (!isSoundscaperProductionProject(project)) return;
	const graph = normalizeMixerGraphV21(project.mixer as unknown as MixerGraphV21);
	const sourceWidth = resolveTerminalChannelWidths(project, Number(project.masterChannels)).tracks.get(track.id) ?? 2;
	for (const edge of graph.edges) {
		if (edge.source.kind !== 'track' || edge.source.id !== track.id
			|| edge.channelMap.every(channel => channel === -1)) continue;
		const defaultMap = defaultMixerChannelMapV21(sourceWidth, edge.channelMap.length);
		if (edge.channelMap.every((channel, index) => channel === defaultMap[index])) continue;
		throw createLocalizedError(RangeError, copy, 'stereoSplitCustomRoutingRequiresReset');
	}
}

function hasStereoClipWithLinkedNoiseGate(project: ControllerProject, clips: readonly ControllerClip[]): boolean {
	const linkedSources = new Set(clips.filter(hasActiveLinkedNoiseGate).map(clip => clip.sourceId));
	return linkedSources.size > 0 && project.sources.some(source => (source.channelCount ?? 0) > 1 && linkedSources.has(source.id));
}

function hasActiveLinkedNoiseGate(owner: Pick<ControllerTrack, 'effects' | 'effectsActive'>): boolean {
	const defaults = NOISE_GATE_EFFECT_DEFINITION.defaults;
	return owner.effectsActive !== false && owner.effects?.some(effect => effect.type === 'noise-gate'
		&& effect.enabled !== false && effect.bypassed !== true
		&& (effect.params?.stereoLink ?? defaults.stereoLink) === 'linked'
		&& Number(effect.params?.rangeDb ?? defaults.rangeDb) < 0) === true;
}
