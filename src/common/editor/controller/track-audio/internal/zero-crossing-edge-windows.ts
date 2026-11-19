/* SPDX-License-Identifier: AGPL-3.0-only */

import { getProjectClips } from '../../../engine/buffer-math.ts';
import { getTrackClips } from '../../../engine/clip-schedule-geometry.ts';
import { projectEffectRacks } from '../../../engine/project-effects.ts';
import type { EngineProject } from '../../../engine/types.ts';
import type { RenderedAudio } from '../../../rendered-audio-channels.ts';
import { zeroCrossingRenderProject } from './zero-crossing-render-project.ts';
import type { SelectionViewProject, SelectionViewServiceRuntime } from './selection-view-service-types.d.ts';

interface Range { readonly startFrame: number; readonly endFrame: number }

/** Keep processor-history routes intact; dry PCM needs only the two search neighborhoods. */
export async function renderZeroCrossingEdges<Project extends SelectionViewProject, Rendered extends RenderedAudio>(
	runtime: Pick<SelectionViewServiceRuntime<Project, Rendered>, 'getProject' | 'cloneProject' | 'renderSnapshot'
		| 'audioBufferChannels' | 'findNearestAudioZeroCrossing'>, project: Project, trackIds: readonly string[],
	selection: Range, radius: number, range: Range,
): Promise<Range | null> {
	const edges = [selection.startFrame, selection.endFrame];
	const captures = trackIds.map(trackId => zeroCrossingRenderProject(runtime.cloneProject(project), trackId));
	let windows: Range[] = [range];
	if (captures.every(capture => dryCapture(capture.project, capture.trackId))) {
		windows = edges.map(frame => {
			const target = Math.max(range.startFrame, Math.min(range.endFrame - 1, frame));
			return { startFrame: Math.max(range.startFrame, target - radius - 1), endFrame: Math.min(range.endFrame, target + radius + 1) };
		});
		if (windows[0]!.endFrame >= windows[1]!.startFrame) windows = [range];
	}
	const snapped = [...edges];
	for (const window of windows) {
		if (runtime.getProject() !== project) return null;
		const rendered = await Promise.all(captures.map(capture => runtime.renderSnapshot(capture.project, {
			...window, includeTail: false, outputFrames: window.endFrame - window.startFrame,
			trackId: capture.trackId, includeMaster: false, includeTrackPan: false, respectMuteSolo: capture.respectMuteSolo,
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

function dryCapture(value: SelectionViewProject, trackId?: string): boolean {
	const project = value as unknown as EngineProject;
	if (project.mixer?.groups?.length || project.mixer?.sends?.length || project.mixer?.cues?.length) return false;
	const tracks = (project.tracks ?? []).filter(track => trackId == null || track.id === trackId);
	if (tracks.some(track => 'audioFreeze' in track && track.audioFreeze != null)) return false;
	const clipsById = new Map(getProjectClips(project).map(clip => [String(clip.id), clip]));
	const clips = tracks.flatMap(track => getTrackClips(track, clipsById));
	if (clips.some(clip => clip.warpMap != null || (clip.speedRatio ?? 1) !== 1 || (clip.pitchCents ?? 0) !== 0 || clip.linkPitchAndTempo || clip.stretchToTempo)) return false;
	// The capture renders only these track and clip racks with master processing disabled.
	return [...projectEffectRacks({ tracks, clips })].every(rack => !rack.effectsActive || rack.effects.every(effect => effect.enabled === false || effect.bypassed === true));
}
