/* SPDX-License-Identifier: AGPL-3.0-only */
interface RecorderChunkMessage {
	readonly frameStart: number;
	readonly frames: number;
	readonly channels?: readonly (Float32Array | readonly number[])[];
}

/** Capture arrival evidence before the controller's serial storage queue. */
export function recordingChunkAtArrival(message: RecorderChunkMessage, receiptTime?: () => number) {
	const receiptTimeMs = receiptTime?.();
	if (receiptTimeMs !== undefined && (!Number.isFinite(receiptTimeMs) || receiptTimeMs < 0)) {
		throw new RangeError('Recording receipt time must be finite and non-negative.');
	}
	return { frameStart: message.frameStart, frames: message.frames,
		channels: (message.channels ?? []).map(channel => channel instanceof Float32Array ? channel : new Float32Array(channel)),
		...(receiptTimeMs === undefined ? {} : { receiptTimeMs }) };
}
