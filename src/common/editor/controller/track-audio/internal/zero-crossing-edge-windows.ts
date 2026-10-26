/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectEffectRacks } from '../../../engine/project-effects.ts';
import type { EngineProject } from '../../../engine/types.ts';
import type { RenderedAudio } from '../../../rendered-audio-channels.ts';
import { zeroCrossingRenderProject } from './zero-crossing-render-project.ts';
import type { SelectionViewProject, SelectionViewServiceRuntime } from './selection-view-service-types.d.ts';

interface Range { readonly startFrame: number; readonly endFrame: number }

/** Keep processor-history routes intact; dry PCM needs only the two search neighborhoods. */
export async function renderZeroCrossingEdges<Project extends SelectionViewProject, Rendered extends RenderedAudio>(
	runtime: SelectionViewServiceRuntime<Project, Rendered>, project: Project, trackIds: readonly string[],
	selection: Range, radius: number, range: Range,
): Promise<Range | null> {
	const edges = [selection.startFrame, selection.endFrame];
	let windows: Range[] = [range];
	if (dryProject(project)) {
		windows = edges.map(frame => {
			const target = Math.max(range.startFrame, Math.min(range.endFrame - 1, frame));
			return { startFrame: Math.max(range.startFrame, target - radius - 1), endFrame: Math.min(range.endFrame, target + radius + 1) };
		});
		if (windows[0]!.endFrame >= windows[1]!.startFrame) windows = [range];
	}
	const captures = trackIds.map(trackId => zeroCrossingRenderProject(runtime.cloneProject(project), trackId));
	const snapped = [...edges];
	for (const window of windows) {
		if (runtime.getProject() !== project) return null;
		const rendered = await Promise.all(captures.map(capture => runtime.renderSnapshot(capture.project, {
			...window, includeTail: false, outputFrames: window.endFrame - window.startFrame,
			trackId: capture.trackId, includeMaster: false, includeTrackPan: false, respectMuteSolo: false,
		})));
		if (runtime.getProject() !== project) return null;
		const channels = rendered.flatMap(runtime.audioBufferChannels);
		for (const [index, frame] of edges.entries()) {
			if (frame < range.startFrame || frame > range.endFrame) continue;
			const target = Math.min(range.endFrame - 1, frame);
			if (target < window.startFrame || target >= window.endFrame) continue;
			snapped[index] = window.startFrame + runtime.findNearestAudioZeroCrossing(channels, target - window.startFrame, { maximumDistance: radius });
		}
	}
	return { startFrame: snapped[0]!, endFrame: snapped[1]! };
}

function dryProject(value: SelectionViewProject): boolean {
	const project = value as unknown as EngineProject;
	if (project.mixer?.groups?.length || project.mixer?.sends?.length || project.mixer?.cues?.length) return false;
	if (project.tracks?.some(track => track.audioFreeze != null)) return false;
	if (project.clips?.some(clip => clip.warpMap != null || (clip.speedRatio ?? 1) !== 1 || (clip.pitchCents ?? 0) !== 0 || clip.linkPitchAndTempo || clip.stretchToTempo)) return false;
	return [...projectEffectRacks(project)].every(rack => !rack.effectsActive || rack.effects.every(effect => effect.enabled === false || effect.bypassed === true));
}
