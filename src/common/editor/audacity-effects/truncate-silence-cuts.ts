/* SPDX-License-Identifier: GPL-3.0-only
 * Disjoint-cut assembly for Audacity TruncSilenceBase's crossfades, extracted
 * from the adaptation in basic.js; its upstream author and license notice applies.
 */

import { sampleOrZero } from './basic-channel-math.js';

interface Region { readonly start: number; readonly end: number }
interface Cut extends Region { readonly blend: number; readonly removedBefore: number }
interface Settings { readonly action: string; readonly truncateTo: number; readonly compressPercent: number }

/** Return null when neighboring blend support requires the sequential implementation. */
export function renderDisjointTruncateSilence(
	channels: readonly Float32Array[], regions: readonly Region[], sampleRate: number,
	settings: Settings, minimumFrames: number, maximumBlendFrames: number,
): Float32Array[] | null {
	const cuts: Cut[] = [];
	let removed = 0;
	for (const region of regions) {
		const inputFrames = region.end - region.start;
		const outputFrames = settings.action === 'truncate' ? Math.min(settings.truncateTo * sampleRate, inputFrames)
			: minimumFrames + (inputFrames - minimumFrames) * settings.compressPercent / 100;
		if (Math.max(0, inputFrames - outputFrames) === 0) continue;
		const start = Math.round(region.start + outputFrames / 2);
		const end = Math.round(region.end - outputFrames / 2);
		if (end <= start) continue;
		const blend = Math.min(maximumBlendFrames, inputFrames);
		const previous = cuts.at(-1);
		if (previous && previous.end + previous.blend - Math.floor(previous.blend / 2) > start - Math.floor(blend / 2)) return null;
		cuts.push({ start, end, blend, removedBefore: removed });
		removed += end - start;
	}
	if (!cuts.length) return null;
	return channels.map(channel => {
		const output = new Float32Array(channel.length - removed);
		let cursor = 0; let destination = 0;
		for (const cut of cuts) {
			const retained = channel.subarray(cursor, cut.start);
			output.set(retained, destination);
			destination += retained.length; cursor = cut.end;
		}
		output.set(channel.subarray(cursor), destination);
		for (let cutIndex = cuts.length - 1; cutIndex >= 0; cutIndex -= 1) {
			const cut = cuts[cutIndex]!;
			const first = cut.start - Math.floor(cut.blend / 2);
			const second = cut.end - Math.floor(cut.blend / 2);
			for (let index = 0; index < cut.blend; index += 1) {
				const target = first - cut.removedBefore + index;
				if (target >= 0 && target < output.length) output[target] = ((cut.blend - index) * sampleOrZero(channel, first + index)
					+ index * sampleOrZero(channel, second + index)) / cut.blend;
			}
		}
		return output;
	});
}
