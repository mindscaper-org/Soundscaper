import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { applyAudacityNoiseReduction, applyAudacityPaulstretch, captureAudacityNoiseProfile } from '../src/common/editor/audacity-effects/spectral.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

function signal(length: number, channel = 0): Float32Array {
	return Float32Array.from({ length }, (_, frame) => (
		Math.sin(frame * 0.071 + channel) * 0.03 + (frame % 911 < 30 ? Math.sin(frame * 0.4) * 0.6 : 0)
	));
}

function digest(channels: readonly Float32Array[]): string {
	const hash = createHash('sha256');
	for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
	return hash.digest('hex');
}

const profile = captureAudacityNoiseProfile([signal(4_099)], 8_000);
const noiseFixtures = [
	[1, 'aed10bdbfd0848a0574e33f976612b608cce839142609af684cbcf047fc6a442', 'fba27741564d198448a060efcd05ed34ac00b0c6590ea1b027c34544e6bc69b0'],
	[511, 'fac9c45c9f1acf8a0368cf5417700d7c0812a28c9967a4c342866fad05be191a', 'fac4ce6192c0ee8432c4f87bd40820303627ecd2a3dcb498a205a740cc97817d'],
	[512, '1cbcf56aab129b626250531deeca97d3d71e67c4edfd467240c3faa2e7617f28', 'a617258b8d5483b74cf278b27cb391672fad108c8a66ac4411c0e1fae7599df9'],
	[513, '0e9f087334a3996a0c45e135f10760e00f33f486f9c0e2119a3feee37804a211', '084273aa15b17bde5d3a4879207421353428a060b67a94fe03bf32dcc754d62a'],
	[2_047, 'a357e9ba600a6aa9d8c8e4f498def42a28f015f01cc8d7f2f5f3616a19e81300', '7e718e94b34b43645b46087264f5ff36739c96700e636c8d6e51d6b288406bc3'],
	[17_003, 'eff4e3ab37e0495033fd3f0d18551eefc8abf3ac03c2015a1d312ea384b864ab', 'b42916d96847a594d7386b7c2369c318a2f21e6994e33224962f8c7f8297eef2'],
] as const;

test('noise reduction preserves exact padded edges, smoothing, attack/release and residue output', () => {
	for (const [length, reduced, residue] of noiseFixtures) for (const output of ['reduce', 'residue'] as const) {
		const actual = applyAudacityNoiseReduction([signal(length), signal(length, 1)], 8_000, {
			reductionDb: 17, sensitivity: 4, frequencySmoothingBands: length % 2 ? 3 : 0, output,
		}, profile);
		assert.equal(digest(actual), output === 'reduce' ? reduced : residue, `${length}, ${output}`);
	}
});

test('Paulstretch retains exact channel seeds and phase RNG', () => {
	const input = [signal(2_051), signal(2_051, 1)];
	for (const [seed, expected] of [
		[0, '38d0716cd600781fa29c005796efe9d066b1d6c072b1232ee84326c1f20012cd'],
		[42, '497a8e03e3c4cf7ca67f8679c57f6fe7ac8e05ae9d8109ddddea629fa17fe2c4'],
		['parity', '6876aece0b22e4e03e41bb0f51205ae4ba56e68b59006f06439c7724b49ce3e3'],
	] as const) {
		const output = applyAudacityPaulstretch(input, 8_000, { timeResolution: 0.032, stretchFactor: 3.7 }, { seed });
		assert.equal(digest(output), expected);
	}
});
