/* SPDX-License-Identifier: AGPL-3.0-only */
import { assertAudacityEffectOutput } from '../../../../audacity-effects/pcm-channel-validation.ts';
import type { EffectResultSourceWriter } from '../effect-result-service.ts';

/** Reblock latency-trimmed packets and source splices into regular storage chunks. */
export function createStreamedPcmWriter(writer: EffectResultSourceWriter, width: number, chunkFrames: number,
	assertCurrent: () => void, append?: (channels: Float32Array[]) => void) {
	const pending = Array.from({ length: width }, () => new Float32Array(chunkFrames));
	let fill = 0, frames = 0;
	async function flush(): Promise<void> {
		if (!fill) return;
		assertCurrent(); const packet = pending.map(channel => channel.subarray(0, fill)); append?.(packet);
		await writer.write(packet); assertCurrent(); frames += fill; fill = 0;
	}
	return {
		get framesWritten() { return frames + fill; },
		async write(channels: Float32Array[]): Promise<void> {
			assertCurrent(); assertAudacityEffectOutput(channels);
			if (channels.length !== width) throw new RangeError('Streamed output channel layout changed.');
			if (fill === 0 && channels[0]!.length === chunkFrames) { append?.(channels); await writer.write(channels); assertCurrent(); frames += chunkFrames; return; }
			for (let offset = 0; offset < channels[0]!.length;) {
				const count = Math.min(chunkFrames - fill, channels[0]!.length - offset);
				for (let channel = 0; channel < width; channel++) pending[channel]!.set(channels[channel]!.subarray(offset, offset + count), fill);
				offset += count; fill += count; if (fill === chunkFrames) await flush();
			}
		},
		finish: flush,
	};
}
