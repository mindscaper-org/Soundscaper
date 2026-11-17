/* SPDX-License-Identifier: AGPL-3.0-only */
import { STREAMED_EFFECT_CHUNK_FRAMES } from './admission.ts';
/** Coalesce internal FFT/window output before crossing the worker or storage boundary. */
export async function* packetizeEffectPcm(input: AsyncGenerator<Float32Array[]>, frameCount: number): AsyncGenerator<Float32Array[]> {
	let pending: Float32Array[] | null = null;
	let fill = 0, emitted = 0;
	for await (const channels of input) {
		const inputFrames = channels[0]!.length;
		if (inputFrames > frameCount - emitted - fill) throw new RangeError('Streamed output exceeds the selection.');
		const nextPacketFrames = Math.min(STREAMED_EFFECT_CHUNK_FRAMES, frameCount - emitted);
		if (fill === 0 && inputFrames === nextPacketFrames && inputFrames > 0
			&& channels.every(channel => channel.byteLength === channel.buffer.byteLength)) {
			emitted += inputFrames;
			yield channels;
			continue;
		}
		for (let start = 0; start < inputFrames;) {
			const packetFrames = Math.min(STREAMED_EFFECT_CHUNK_FRAMES, frameCount - emitted);
			pending ??= channels.map(() => new Float32Array(packetFrames));
			const count = Math.min(packetFrames - fill, inputFrames - start);
			for (let channel = 0; channel < channels.length; channel++) {
				const source = channels[channel]!;
				pending[channel]!.set(start === 0 && count === inputFrames ? source : source.subarray(start, start + count), fill);
			}
			start += count;
			fill += count;
			if (fill === packetFrames) {
				const ready = pending;
				pending = null;
				fill = 0;
				emitted += packetFrames;
				yield ready;
			}
		}
	}
	if (pending && fill) yield pending.map(channel => channel.subarray(0, fill));
}
