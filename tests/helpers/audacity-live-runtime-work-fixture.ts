/* SPDX-License-Identifier: GPL-3.0-only */
import { createHash } from 'node:crypto';
import { createAudacityLiveProcessor } from '../../src/common/editor/audacity-effects/live.js';
import { captureAudacityNoiseProfile } from '../../src/common/editor/audacity-effects/spectral.js';

type Processor = { process(input: Float32Array[], output: Float32Array[]): boolean; updateParams(value: Record<string, unknown>): void; setNoiseProfile(profile: unknown): void };
export type LiveWorkKind = 'click' | 'dynamics' | 'noise' | 'converted-noise';
export function liveWorkFixture(kind: LiveWorkKind) {
	const sampleRate = 48000, profileRate = kind === 'converted-noise' ? 44100 : sampleRate;
	const noise = Float32Array.from({ length: 8192 }, (_, frame) => 0.03 * Math.sin(frame * 0.47) + 0.01 * Math.cos(frame * 0.793));
	const profile = kind.includes('noise') ? captureAudacityNoiseProfile([noise], profileRate) : null;
	const type = kind === 'click' ? 'audacity-click-removal' : kind === 'dynamics' ? 'audacity-compressor' : 'audacity-noise-reduction';
	const params = kind === 'click' ? { threshold: 200, maximumWidth: 20 } : kind === 'dynamics'
		? { lookaheadMs: 1000, makeupGainDb: 0, thresholdDb: -18 } : { reductionDb: 12, sensitivity: 6, frequencySmoothingBands: 3 };
	const processor = createAudacityLiveProcessor(type, sampleRate, params, { noiseProfile: profile }) as Processor;
	return { processor, profileRate, noise };
}
export function renderLiveWork(kind: LiveWorkKind, options: { alias?: boolean; updates?: boolean; missing?: boolean } = {}): string {
	const { processor, profileRate, noise } = liveWorkFixture(kind);
	const input = [new Float32Array(128), new Float32Array(128)];
	const output = options.alias ? [input[1]!, input[0]!] : [new Float32Array(128), new Float32Array(128)];
	const rendered = [new Float32Array(96000), new Float32Array(96000)];
	for (let block = 0; block < 750; block += 1) {
		for (let channel = 0; channel < 2; channel += 1) for (let frame = 0; frame < 128; frame += 1) {
			const index = block * 128 + frame;
			input[channel]![frame] = 0.17 * Math.sin(index * 0.027 + channel) + 0.012 * Math.cos(index * 0.137) + (index % 1777 === 0 ? 0.9 : 0);
		}
		if (options.updates && block === 250) processor.updateParams(kind === 'dynamics' ? { thresholdDb: -12 } : kind === 'click' ? { threshold: 150 } : { sensitivity: 8 });
		if (options.updates && block === 500) processor.updateParams(kind === 'dynamics' ? { makeupGainDb: 2 } : kind === 'click' ? { maximumWidth: 15 } : { frequencySmoothingBands: 5, reductionDb: 9 });
		if (options.updates && kind.includes('noise') && block === 625) processor.setNoiseProfile(captureAudacityNoiseProfile([noise.map((value) => value * 0.7)], profileRate));
		processor.process(options.missing && block >= 175 && block < 250 ? [input[0]!] : input, output);
		for (let channel = 0; channel < 2; channel += 1) rendered[channel]!.set(output[channel]!, block * 128);
	}
	const hash = createHash('sha256');
	for (const channel of rendered) hash.update(new Uint8Array(channel.buffer));
	return hash.digest('hex');
}
