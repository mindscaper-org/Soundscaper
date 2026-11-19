/* SPDX-License-Identifier: GPL-3.0-only
 * Incremental Audacity 3.7.7 click removal; attribution in audacity-click-removal-kernel.ts applies.
 */
import { createAudacityClickRemovalWorkspace, removeAudacityClicksFromWindowInPlace } from '../audacity-effects/audacity-click-removal-kernel.ts';

/** The finite last window differs from a live stream padded with silence. */
export async function* streamClickRemoval(input: AsyncGenerator<Float32Array[]>, params: Readonly<Record<string, unknown>>, frameCount: number): AsyncGenerator<Float32Array[]> {
	if (Number(params.threshold) === 0 || Number(params.maximumWidth) === 0) { yield* input; return; }
	const hop = 4096, size = 8192;
	if (frameCount <= hop) throw new RangeError('Click Removal requires more than 4096 samples.');
	const workspace = createAudacityClickRemovalWorkspace(size, hop);
	let windows: Float32Array[] = [], fill = 0, start = 0, separation = 2049;
	for await (const channels of input) {
		if (!windows.length) windows = channels.map(() => new Float32Array(size));
		for (let from = 0; from < channels[0]!.length;) {
			const count = Math.min(size - fill, channels[0]!.length - from);
			channels.forEach((channel, c) => windows[c]!.set(channel.subarray(from, from + count), fill)); fill += count; from += count;
			if (fill === size) {
				processWindow(); yield windows.map(channel => channel.slice(0, hop));
				windows.forEach(channel => channel.copyWithin(0, hop)); fill = hop; start += hop;
			}
		}
	}
	if (start + hop < frameCount) { windows.forEach(channel => channel.fill(0, fill)); processWindow(); }
	if (fill) yield windows.map(channel => channel.slice(0, fill));
	function processWindow(): void {
		for (const window of windows) separation = removeAudacityClicksFromWindowInPlace(window, Number(params.threshold), Number(params.maximumWidth), separation, workspace);
	}
}
