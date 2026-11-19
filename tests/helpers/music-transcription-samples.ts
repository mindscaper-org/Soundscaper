/* SPDX-License-Identifier: AGPL-3.0-only */
/** Original synthesized fixture: two melody notes followed by a C-major chord. */
export function musicTranscriptionFixtureSamples(): Float32Array {
	const sampleRate = 22_050, samples = new Float32Array(sampleRate * 6);
	for (const [start, pitches] of [[0.2, [69]], [2.1, [72]], [4.1, [60, 64, 67]]] as const) {
		for (const pitch of pitches) {
			const frequency = 440 * 2 ** ((pitch - 69) / 12);
			for (let i = 0; i < Math.round(1.2 * sampleRate); i++) {
				const time = i / sampleRate;
				const envelope = Math.min(1, time / 0.02) * Math.min(1, (1.2 - time) / 0.08) * Math.exp(-1.2 * time);
				let value = 0;
				for (let harmonic = 1; harmonic <= 5; harmonic++) value += Math.sin(2 * Math.PI * frequency * harmonic * time) / harmonic ** 2;
				const index = Math.round(start * sampleRate) + i;
				samples[index] = samples[index]! + value * envelope * (pitches.length === 1 ? 0.5 : 0.18);
			}
		}
	}
	return samples;
}
