/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzlibSync } from 'fflate';

// Unmodified libFLAC 1.4.3 output with write-only Ogg callbacks and no sample estimate.
const ENCODED = 'eNrzT08PZmBiQANPhPtmMRrXu/k4OjMCuWk+ic5ASkmAQQCqgOuI0wd0TSAANg4FgPQnNOxoZtRpYWDQUADyilLTUotS85JTFXIyk0BWKBjqmegZKxgZGBkbmBkZw81huSqJMAfkxtfP/dn4/0NBLpi0+v/jZAeDsiOD0NbTBYy8h0fhKByFo3CQwEN9DIo/vmdvD7y4c4cig1Hx5DlznjxXt7Q8ec6vaJQzyhnlDH6Ow3be/z8qZzByXjnsziDfn7z19ooXd+4INAiNBs4oh3LOWRaGuuu6B1gM7ozCUThsoEIUAMv9zdk=';
const PATTERN = [0.25, 0.125, -0.25, -0.125, 0.375, 0, -0.375] as const;

export function libflacOggPipeFixture() {
	const file = new File([unzlibSync(Uint8Array.from(atob(ENCODED), character => character.charCodeAt(0)))],
		'Pipe recording.oga', { type: 'audio/ogg' });
	const frameCount = 6_613;
	const samples = [0, 1].map(channel => Float32Array.from({ length: frameCount },
		(_, frame) => PATTERN[(frame * 2 + channel) % PATTERN.length]!));
	return { file, samples, sampleRate: 44_100, frameCount, channelCount: 2 };
}
