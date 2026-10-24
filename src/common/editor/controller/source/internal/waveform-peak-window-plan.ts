/* SPDX-License-Identifier: AGPL-3.0-only */
import { MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS } from '../../../waveform-peak-contract.ts';
import type { WaveformPcmRange } from '../waveform-analysis.ts';

/** Keep nearby zoom steps on one resolution and scroll windows on one source grid. */
export function planWaveformPeakWindow(
	range: WaveformPcmRange,
	pixelWidth: number,
	maximumBlockSize: number,
	sourceFrameCount?: number,
) {
	const limit = Math.min(Math.floor((range.endFrame - range.startFrame) / pixelWidth), maximumBlockSize);
	const exact = { ...range, blockSize: limit, pixelWidth, maximumBlockSize };
	// Near sample level retain exact buckets; overscan needs authenticated source bounds.
	if (limit < 16 || !Number.isSafeInteger(sourceFrameCount) || sourceFrameCount! < range.endFrame) return exact;
	const blockSize = 2 ** Math.floor(Math.log2(limit));
	const tileFrames = blockSize * 256;
	const startFrame = Math.max(0, (Math.floor(range.startFrame / tileFrames) - 1) * tileFrames);
	const endFrame = Math.min(sourceFrameCount!, (Math.ceil(range.endFrame / tileFrames) + 1) * tileFrames);
	if (Math.ceil((endFrame - startFrame) / blockSize) > MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS) return exact;
	return { startFrame, endFrame, blockSize, pixelWidth: (endFrame - startFrame) / blockSize, maximumBlockSize: blockSize };
}
