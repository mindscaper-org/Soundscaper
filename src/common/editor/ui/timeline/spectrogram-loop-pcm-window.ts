/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop, withoutClipLoop } from '../../audio-clip-loop.ts';
import { createSpectrogramSampleViews } from '../../spectrogram-sample-view.ts';
import { pcmWindowCoversProjectedClip } from './preview.ts';
import type { TimelinePcmWindow, TimelineWaveformClip } from './waveform-view-model.ts';

/** Stitch a bounded FFT context across a repeat seam without reading the whole period. */
export async function readLoopSpectrogramPcmWindow(
	clip: TimelineWaveformClip,
	startFrame: number,
	endFrame: number,
	request: (startFrame: number, endFrame: number) => Promise<TimelinePcmWindow | null>,
	signal?: AbortSignal,
): Promise<Readonly<{ pcm: TimelinePcmWindow; clip: TimelineWaveformClip }> | null> {
	const loop = readClipLoop(clip);
	if (!loop) throw new TypeError('A fragmented spectrogram context requires a loop.');
	const frames = endFrame - startFrame;
	let channels: Float32Array[] | null = null;
	for (let cursor = startFrame; cursor < endFrame;) {
		signal?.throwIfAborted();
		const remaining = loop.periodFrames - (cursor + loop.offsetFrames) % loop.periodFrames;
		const end = Math.min(endFrame, cursor + remaining);
		const part = { ...clip, waveformStartFrame: cursor, waveformEndFrame: end };
		const pcm = await request(cursor, end);
		signal?.throwIfAborted();
		if (!pcm || !pcmWindowCoversProjectedClip(pcm, part)) return null;
		const views = createSpectrogramSampleViews(pcm.channels, part, { sourceFrameOffset: pcm.startFrame });
		channels ??= views.map(() => new Float32Array(frames));
		if (channels.length !== views.length) throw new RangeError('Spectrogram loop channel count changed between reads.');
		for (const [index, view] of views.entries()) {
			const output = channels[index]!;
			for (let frame = 0; frame < view.length; frame += 1) output[cursor - startFrame + frame] = view.sampleAt(frame);
		}
		cursor = end;
	}
	if (!channels) return null;
	return {
		pcm: { startFrame: 0, endFrame: frames, channels },
		// The stitched PCM already carries the original mapping, gain and fades.
		clip: { ...clip, opaqueExtensions: withoutClipLoop(clip.opaqueExtensions),
			durationFrames: frames, sourceStartFrame: 0, sourceDurationFrames: frames,
			waveformStartFrame: 0, waveformEndFrame: frames, gain: 1, inverted: false,
			reversed: false, fadeInFrames: 0, fadeOutFrames: 0 },
	};
}
