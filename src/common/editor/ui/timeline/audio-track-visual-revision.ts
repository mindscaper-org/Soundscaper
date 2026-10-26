/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimelineClipVisualController, TimelineWaveformClip } from './waveform-view-model.ts';

type VisualRevisionClip = Pick<TimelineWaveformClip, 'id' | 'projectBinClipId'> & Readonly<{
	isRecordingPreview?: boolean;
}>;

/** Identify only the media data used by a row's currently projected clips. */
export function createAudioTrackVisualRevisionReader(): (
	controller: TimelineClipVisualController,
	clips: readonly VisualRevisionClip[],
) => readonly unknown[] {
	let previous: readonly unknown[] = Object.freeze([]);
	return (controller, clips) => {
		let content: unknown[] | undefined;
		let index = 0;
		const compare = (value: unknown) => {
			if (!content && !Object.is(value, previous[index])) content = previous.slice(0, index);
			if (content) content.push(value);
			index++;
		};
		for (const clip of clips) {
			if (clip.isRecordingPreview) continue;
			const visual = controller.getClipVisualData(clip.id)
				|| controller.getProjectBinClipVisualData?.(clip.projectBinClipId || clip.id);
			// Visual getters return fresh wrappers. Immutable media references
			// change when a source or a bounded analysis window is published.
			compare(clip.id);
			compare(visual?.available ?? false);
			compare(visual?.source ?? null);
			compare(visual?.buffer ?? null);
			compare(visual?.peaks ?? null);
			compare(visual?.pcmWindow ?? null);
			compare(visual?.peakWindow ?? null);
			compare(visual?.frequencyAnalysis ?? null);
			compare(visual?.frequencyWindow ?? null);
		}
		if (!content && index === previous.length) return previous;
		previous = Object.freeze(content ?? previous.slice(0, index));
		return previous;
	};
}
