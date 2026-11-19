/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzlibSync } from 'fflate';

// Unmodified libsndfile 1.2.2 SF_FORMAT_W64 | SF_FORMAT_PCM_16 output.
// The 4,411 stereo frames end four bytes short of the next 8-byte boundary.
const SOURCE = 'eNrtzLENAQEUBuBHbgA2UKrEENQaC1zCJQqNXNhBRGII3TU2YAJEornGCBILuKC4BXTfq96X/8+/mGVZb3du7+/dMjlFjIfxuVW6nL6KW3tzjeNoW66zed6pu/utRSOaMSgiWodmJNGKSZqn9V7y24tOFT7iGf3qvxARERERERERERERERERERERERERERERERERERERERERERH9R2+Pkee6';
const PATTERN = [0.25, 0.125, -0.25, -0.125, 0.375, 0, -0.375] as const;

export function libsndfileWave64Fixture() {
	const frameCount = 4_411;
	const sampleRate = 44_100;
	const file = new File([unzlibSync(Uint8Array.from(atob(SOURCE), character => character.charCodeAt(0)))],
		'Field recording.w64', { type: 'audio/x-w64' });
	const sampleAt = (frame: number, channel: number): number => PATTERN[(frame * 2 + channel) % PATTERN.length]!;
	return { file, frameCount, sampleRate, sampleAt };
}
