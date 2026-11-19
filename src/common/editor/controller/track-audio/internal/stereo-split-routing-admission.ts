/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import { rackSignalChannelCount } from '../../../effect-signal-width.ts';
import { defaultMixerChannelMapV21, normalizeMixerGraphV21, type MixerGraphV21 }
	from '../../../mixer-graph-v21.ts';
import { isSoundscaperProductionProject } from '../../../project-schema-version.ts';
import { resolveTerminalChannelWidths } from '../../../terminal-channel-widths.ts';
import type { ControllerClip, ControllerProject, ControllerTrack } from '../track-domain-types.ts';

/** Independent mono racks cannot preserve a processor's stereo output or arbitrary channel maps. */
export function assertStereoSplitRepresentable(
	project: ControllerProject,
	track: ControllerTrack,
	clips: readonly ControllerClip[],
	copy: object,
): void {
	if (rackSignalChannelCount(track, 1) > 1 || clips.some(clip => rackSignalChannelCount(clip, 1) > 1)) {
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
