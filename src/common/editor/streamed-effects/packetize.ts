/* SPDX-License-Identifier: AGPL-3.0-only */
import { STREAMED_EFFECT_CHUNK_FRAMES } from './admission.ts';
/** Coalesce internal FFT/window output before crossing the worker or storage boundary. */
export async function* packetizeEffectPcm(input: AsyncGenerator<Float32Array[]>): AsyncGenerator<Float32Array[]> {
	let pending: Float32Array[] = [], fill = 0;
	for await (const channels of input) {
		if (fill === 0 && channels[0]!.length === STREAMED_EFFECT_CHUNK_FRAMES) { yield channels; continue; }
		if (!pending.length) pending = channels.map(() => new Float32Array(STREAMED_EFFECT_CHUNK_FRAMES));
		for (let start = 0; start < channels[0]!.length;) {
			const count = Math.min(STREAMED_EFFECT_CHUNK_FRAMES - fill, channels[0]!.length - start);
			channels.forEach((channel, c) => pending[c]!.set(channel.subarray(start, start + count), fill)); start += count; fill += count;
			if (fill === STREAMED_EFFECT_CHUNK_FRAMES) { const ready = pending; pending = channels.map(() => new Float32Array(STREAMED_EFFECT_CHUNK_FRAMES)); fill = 0; yield ready; }
		}
	}
	if (fill) yield pending.map(channel => channel.subarray(0, fill));
}
