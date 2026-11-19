/* SPDX-License-Identifier: AGPL-3.0-only */

/** Repeatable voiced units with independent timing and stable spectral identities. */
export function dialogueFixture(durations: readonly number[], rate = 8000, gain = 1): Float32Array {
	const output = new Float32Array(Math.round(durations.reduce((sum, value) => sum + value, 0) * rate));
	let offset = 0;
	for (const [unit, duration] of durations.entries()) {
		const count = Math.round(duration * rate), formant = [480, 1100, 1850, 2700][unit % 4]!;
		for (let frame = 0; frame < count; frame++) {
			const time = frame / rate, edge = Math.min(1, frame / (rate * .025), (count - frame) / (rate * .025));
			output[offset + frame] = gain * edge * (.12 * Math.sin(2 * Math.PI * 160 * time)
				+ .24 * Math.sin(2 * Math.PI * formant * time) + .08 * Math.sin(2 * Math.PI * (formant + 160) * time));
		}
		offset += count;
	}
	return output;
}
