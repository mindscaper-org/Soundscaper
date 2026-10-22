/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasProductionMixerProjectAuthority } from '../../../project-schema-version.ts';
import { resolveTerminalChannelWidths, type TerminalWidthProject } from '../../../terminal-channel-widths.ts';
import { createIsolatedTrackRenderProjectV21, type IsolatedTrackRenderProjectV21 } from '../../shared/isolated-track-render-project-v21.ts';
import type { SelectionViewProject } from './selection-view-service-types.d.ts';

/** A crossing belongs to the recording's linked channels, before programme downmix. */
export function zeroCrossingRenderProject<Project extends SelectionViewProject>(project: Project, trackId: string) {
	const masterChannels = typeof project.masterChannels === 'number' ? project.masterChannels : 2;
	const width = resolveTerminalChannelWidths(project as unknown as TerminalWidthProject, masterChannels).tracks.get(trackId) ?? masterChannels;
	const outputChannels = Math.max(width, masterChannels);
	const wide = width > masterChannels ? { ...project, masterChannels: outputChannels } : project;
	if (!hasProductionMixerProjectAuthority(wide)) return { project: wide, trackId };
	const native = wide as unknown as IsolatedTrackRenderProjectV21;
	const capture = createIsolatedTrackRenderProjectV21({ ...native, mixer: { ...native.mixer,
		outputs: native.mixer.outputs.map(output => output.role === 'main' ? { ...output, channelCount: outputChannels } : output),
	} }, { trackId, effects: [], preserveTrackProcessing: true });
	return { project: capture as unknown as Project,
		// A retained detector closure must reach the selected rack, without contributing output audio.
		trackId: capture.tracks.length > 1 ? undefined : trackId };
}
