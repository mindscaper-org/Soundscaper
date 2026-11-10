/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StaffPadWasmRuntime } from '../../staffpad/wasm-instance.ts';
import type { autoTuneRealtimeGeometry } from './realtime-contract.ts';

/** A private runtime belongs to one processor. Build all sessions before
 * retaining heap views; no typed arrays or native sessions are created in the
 * audio callback. Feed fixed ABI blocks so caller partitions cannot move hops.
 */
export function createAutoTuneNativeStream(runtime: StaffPadWasmRuntime, sampleRate: number,
	channelCount: number, geometry: ReturnType<typeof autoTuneRealtimeGeometry>) {
	const sessions: ReturnType<StaffPadWasmRuntime['createSession']>[] = [];
	try {
		for (let channel = 0; channel < channelCount; channel += 2) {
			sessions.push(runtime.createSession(sampleRate, Math.min(2, channelCount - channel), true));
		}
	} catch (error) { for (const session of sessions) session.destroy(); throw error; }
	const heap = runtime.memory.buffer;
	const inputs = sessions.flatMap(session => session.inputPointers.map(pointer => new Float32Array(heap, pointer, runtime.maximumBlockSize)));
	const outputs = sessions.flatMap(session => session.outputPointers.map(pointer => new Float32Array(heap, pointer, runtime.maximumBlockSize)));
	const queued = Array.from({ length: channelCount }, () => new Float32Array(geometry.queueFrames));
	let received = 0, read = 0, write = geometry.deliveryFrames, available = write;
	return {
		reset(): void {
			for (const session of sessions) {
				if (runtime.exports.sp_reset(session.handle) !== 0) throw new Error('Auto-Tune failed to reset its native session.');
				session.setParameters(1, 1);
			}
			for (const channel of queued) channel.fill(0);
			received = 0; read = 0; write = geometry.deliveryFrames; available = write;
		},
		dispose(): void { for (const session of sessions) session.destroy(); },
		processFrame(samples: Float64Array, ratio: number): void {
			if (runtime.memory.buffer !== heap) throw new Error('Auto-Tune native memory grew during audio processing.');
			for (let channel = 0; channel < channelCount; channel++) inputs[channel][received] = samples[channel];
			if (++received === geometry.nativeBlockFrames) {
				for (const session of sessions) {
					session.setParameters(1, ratio);
					if (runtime.exports.sp_feed(session.handle, received) !== received) throw new Error('Auto-Tune rejected native input.');
				}
				received = 0;
				const produced = sessions[0].availableOutput();
				if (available + produced > geometry.queueFrames) throw new Error('Auto-Tune exceeded its fixed output queue.');
				let copied = 0;
				while (copied < produced) {
					const frames = Math.min(produced - copied, runtime.maximumBlockSize);
					for (const session of sessions) {
						if (session.availableOutput() < frames || runtime.exports.sp_read(session.handle, frames) !== frames) throw new Error('Auto-Tune channel pairs lost synchronization.');
					}
					for (let channel = 0; channel < channelCount; channel++) for (let frame = 0; frame < frames; frame++) {
						queued[channel][(write + copied + frame) % geometry.queueFrames] = outputs[channel][frame];
					}
					copied += frames;
				}
				write = (write + produced) % geometry.queueFrames;
				available += produced;
			}
			if (available < 1) throw new Error('Auto-Tune exhausted its fixed delivery reserve.');
			for (let channel = 0; channel < channelCount; channel++) samples[channel] = queued[channel][read];
			read = (read + 1) % geometry.queueFrames;
			available--;
		},
	};
}
