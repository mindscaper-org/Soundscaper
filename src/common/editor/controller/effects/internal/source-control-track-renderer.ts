/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop } from '../../../audio-clip-loop.ts';
import { clipSourcePreviewWarpMap } from '../../../clip-source-timing.ts';
import type { HoldTempoMap } from '../../../timeline-time.ts';
import type { EffectSelectionProject, EffectTarget } from '../effect-selection-service.ts';

type RenderRange = (trackId: string, startFrame: number, endFrame: number) => Promise<Float32Array[]>;
const WINDOW_FRAMES = 16_384;

/** Auto Duck reads its first control channel in the selected clip's placement,
 * then converts that bounded timeline window back into native source samples. */
export function createSourceControlTrackRenderer(getProject: () => EffectSelectionProject, renderRange: RenderRange) {
	return async (trackId: string, target: EffectTarget): Promise<Float32Array[]> => {
		if (!target.sourceClipId) return renderRange(trackId, target.startFrame, target.endFrame);
		const project = getProject();
		const clip = project.clips.find(item => item.id === target.sourceClipId && item.kind === 'audio');
		const source = project.sources?.find(item => item.id === target.sourceId);
		if (!clip || clip.sourceId !== target.sourceId || !source
			|| typeof source.sampleRate !== 'number' || typeof source.frameCount !== 'number') {
			throw new RangeError('The source control track selection is no longer available.');
		}
		const rate = project.sampleRate / source.sampleRate;
		const loop = readClipLoop(clip);
		const timingClip = loop ? { ...clip, durationFrames: loop.periodFrames } : clip;
		// The command project owns its validated tempo map. Sample-anchored maps
		// do not consult it; musical maps retain every tempo breakpoint here.
		const warp = clipSourcePreviewWarpMap({ sampleRate: project.sampleRate, tempoMap: project.tempoMap as HoldTempoMap },
			timingClip, { sampleRate: source.sampleRate, frameCount: source.frameCount });
		const points = warp?.points.map(point => ({ source: point.source.num / point.source.den, outer: point.outer.num / point.outer.den }));
		const sourceEnd = clip.sourceStartFrame + clip.sourceDurationFrames;
		const timelineAt = (frame: number): number => {
			if (frame < clip.sourceStartFrame) return clip.timelineStartFrame + (frame - clip.sourceStartFrame) * rate;
			if (frame >= sourceEnd) return clip.timelineStartFrame + clip.durationFrames + (frame - sourceEnd) * rate;
			let offset: number;
			if (points) {
				let lower = 0;
				let upper = points.length - 1;
				while (upper - lower > 1) {
					const middle = Math.floor((lower + upper) / 2);
					if (points[middle]!.source <= frame) lower = middle;
					else upper = middle;
				}
				const left = points[lower]!;
				const right = points[upper]!;
				offset = left.outer + (frame - left.source) / (right.source - left.source) * (right.outer - left.outer);
			} else {
				// The first reversed sample is one frame inside the exclusive source end.
				const sourceOffset = clip.reversed ? sourceEnd - 1 - frame : frame - clip.sourceStartFrame;
				offset = sourceOffset * timingClip.durationFrames / clip.sourceDurationFrames;
			}
			if (loop) {
				offset = ((offset - loop.offsetFrames) % loop.periodFrames + loop.periodFrames) % loop.periodFrames;
			}
			return clip.timelineStartFrame + offset;
		};
		const output = new Float32Array(target.endFrame - target.startFrame);
		let windowStart = -1;
		let window: Float32Array = new Float32Array(0);
		for (let index = 0; index < output.length; index++) {
			const position = timelineAt(target.startFrame + index);
			if (position < 0) continue;
			const start = Math.floor(position / WINDOW_FRAMES) * WINDOW_FRAMES;
			if (start !== windowStart) {
				window = (await renderRange(trackId, start, start + WINDOW_FRAMES + 1))[0] ?? new Float32Array(0);
				windowStart = start;
			}
			const local = position - start;
			const left = Math.floor(local);
			const fraction = local - left;
			output[index] = (window[left] ?? 0) * (1 - fraction) + (window[left + 1] ?? 0) * fraction;
		}
		return [output];
	};
}
