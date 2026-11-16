/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { instantiateStaffPadWasm } from '../src/common/editor/staffpad/wasm-instance.ts';
import { renderAlignedDialogue } from '../src/common/editor/dialogue-alignment-render.ts';
import { analyzeDialogueAlignment } from '../src/common/editor/dialogue-alignment.ts';
import { dialogueFixture } from './helpers/dialogue-alignment-fixture.ts';

async function runtime() {
	return instantiateStaffPadWasm(await WebAssembly.compile(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url))));
}

test('variable dialogue stretching preserves pitch, stereo polarity and exact output length', async () => {
	const rate = 48000;
	const tone = Float32Array.from({ length: rate }, (_, frame) => .3 * Math.sin(2 * Math.PI * 440 * frame / rate));
	const output = renderAlignedDialogue([tone, tone.map(value => -value)], rate, {
		inputFrames: rate, outputFrames: rate, mismatch: 0,
		points: [{ outputFrame: 0, sourceFrame: 0 }, { outputFrame: rate / 2, sourceFrame: rate * .7 }, { outputFrame: rate, sourceFrame: rate }],
	}, await runtime());
	assert.equal(output[0]!.length, rate);
	for (let index = 0; index < rate; index++) {
		assert.ok(Number.isFinite(output[0]![index]));
		assert.ok(Math.abs(output[0]![index]! + output[1]![index]!) < 1e-5);
	}
	for (const start of [rate * .2, rate * .7]) {
		let greatest = 0, peak = 0;
		for (let frequency = 400; frequency <= 480; frequency += 2) {
			let real = 0, imaginary = 0;
			for (let index = 0; index < 4096; index++) {
				const value = output[0]![start + index]!;
				real += value * Math.cos(2 * Math.PI * frequency * index / rate);
				imaginary += value * Math.sin(2 * Math.PI * frequency * index / rate);
			}
			const power = real ** 2 + imaginary ** 2;
			if (power > greatest) { greatest = power; peak = frequency; }
		}
		assert.ok(Math.abs(peak - 440) <= 2, `pitch ${peak} Hz`);
	}
});

test('rendered acoustic units move toward reference timing with one continuous stretch session', async () => {
	const rate = 48000, reference = dialogueFixture([.45, .6, .35, .5], rate), replacement = dialogueFixture([.6, .4, .55, .35], rate);
	const map = analyzeDialogueAlignment({ reference: [reference], replacement: [replacement], sampleRate: rate, strength: 1 });
	const output = renderAlignedDialogue([replacement], rate, map, await runtime())[0]!;
	const aligned = analyzeDialogueAlignment({ reference: [reference], replacement: [output], sampleRate: rate, strength: 1 });
	for (const frame of [.45, 1.05, 1.4]) {
		const point = aligned.points.reduce((nearest, candidate) => Math.abs(candidate.outputFrame / rate - frame) < Math.abs(nearest.outputFrame / rate - frame) ? candidate : nearest);
		assert.ok(Math.abs(point.sourceFrame / rate - frame) < .09, `unit at ${frame}: ${point.sourceFrame / rate}`);
	}
});
