/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareSoundscaperNativeRecordingInput, type NativeRecordingInputRequest } from '../../../soundscaper-native-audio-capture.ts';
import type { RecordingCapturePool } from '../recording-transaction-types.ts';

export function acquireRecordingHardwareInput(
	pool: RecordingCapturePool,
	request: NativeRecordingInputRequest,
	singleNativeSource: boolean,
) {
	const acquire = () => {
		request.signal?.throwIfAborted();
		return pool.acquireHardware(request.deviceId, { channelCount: request.channelCount, sampleRate: request.sampleRate });
	};
	const preparation = singleNativeSource ? prepareSoundscaperNativeRecordingInput(request) : undefined;
	return preparation ? preparation.then(acquire) : acquire();
}
