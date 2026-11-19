/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveEarDelivery } from '../src/common/editor/ear-delivery.ts';
import { createEarGainCalculator } from '../src/common/editor/ear/gain-calculator.ts';
import { renderEarProgramme } from '../src/common/editor/ear/render.ts';
import { admBedSpeakers } from '../src/common/editor/adm-bed-layout.ts';
import { normalizeAdmProjectMetadata, type AdmAuthoredMetadata } from '../src/common/editor/adm-project-metadata.ts';

const metadata = normalizeAdmProjectMetadata({
	mode: 'authored', programme: { name: 'Programme', language: 'eng' },
	content: { name: 'Content', language: 'eng' },
	bed: { name: 'Bed', layout: '5.1', assignments: [] },
	objects: [{ id: 'voice', name: 'Voice', stripKind: 'track', stripId: 'voice', sourceChannel: 0,
		position: { azimuth: 0, elevation: 0, distance: 1 } }],
}) as AdmAuthoredMetadata;

async function calculator(layout = '5.1') {
	return createEarGainCalculator(await readFile(new URL('../src/common/editor/ear/ear.wasm', import.meta.url)), layout);
}

test('EAR is opt-in, resolves output width, and refuses ambiguous deliveries', () => {
	assert.equal(resolveEarDelivery(metadata, { mode: 'mix', format: 'wav' }), null);
	const plan = resolveEarDelivery(metadata, { mode: 'mix', format: 'wav', earLayout: '7.1.4' });
	assert.equal(plan?.channelCount, 12);
	assert.equal(plan?.sourceChannelCount, 7);
	assert.equal(plan?.layout, '7.1.4');
	for (const options of [
		{ mode: 'stems' }, { format: 'bw64' }, { binaural: true }, { earLayout: 'unknown' },
	]) assert.throws(() => resolveEarDelivery(metadata, { mode: 'mix', format: 'wav', earLayout: '5.1', ...options }));
	assert.throws(() => resolveEarDelivery(null, { mode: 'mix', format: 'wav', earLayout: 'stereo' }), /authored/u);
	assert.throws(() => resolveEarDelivery({ mode: 'passthrough' } as never,
		{ mode: 'mix', format: 'wav', earLayout: 'stereo' }), /authored/u);
});

test('the real EBU core routes matching bed speakers and a front object to centre', async () => {
	const gains = await calculator();
	try {
		for (const [index, speaker] of admBedSpeakers('5.1').entries()) {
			const actual = gains.direct(speaker);
			for (let output = 0; output < 6; output += 1) {
				assert.ok(Math.abs((actual[output] ?? NaN) - (index === output ? 1 : 0)) < 1e-5,
					`${speaker.channel} output ${output}: ${actual}`);
			}
		}
		assert.deepEqual(gains.object({ azimuth: 0, elevation: 0, distance: 1 }).map((gain) => Math.round(gain * 1e5) / 1e5),
			[0, 0, 1, 0, 0, 0]);
		const panned = gains.object({ azimuth: 15, elevation: 0, distance: 1 });
		assert.ok(panned[0]! > 0 && panned[2]! > 0);
		assert.ok(Math.abs(panned.reduce((sum, gain) => sum + gain * gain, 0) - 1) < 1e-5);
	} finally { gains.close(); }
});

test('height objects reach height channels and objects never feed the LFE', async () => {
	const gains = await calculator('7.1.4');
	try {
		const speaker = admBedSpeakers('7.1.4')[8]!;
		const actual = gains.object({ azimuth: speaker.azimuth, elevation: speaker.elevation, distance: 1 });
		assert.ok(Math.abs(actual[8]! - 1) < 1e-5);
		assert.equal(actual[3], 0);
	} finally { gains.close(); }
});

test('EAR renders the full bed and object programme without changing input or duration', async () => {
	const gains = await calculator();
	try {
		const channels = Array.from({ length: 7 }, () => new Float32Array(4));
		channels[0]![0] = 0.25;
		channels[3]![1] = 0.5;
		channels[6]![2] = 0.75;
		const original = channels.map((channel) => channel.slice());
		const output = renderEarProgramme(metadata, channels, gains);
		assert.equal(output.length, 6);
		assert.deepEqual(Array.from(output[0]!), [0.25, 0, 0, 0]);
		assert.deepEqual(Array.from(output[3]!), [0, 0.5, 0, 0]);
		assert.deepEqual(Array.from(output[2]!), [0, 0, 0.75, 0]);
		assert.deepEqual(channels, original);
		assert.throws(() => renderEarProgramme(metadata, channels.slice(1), gains), /channel/u);
		assert.throws(() => renderEarProgramme(metadata, [...channels.slice(0, 6), new Float32Array(3)], gains), /length/u);
		assert.throws(() => gains.object({ azimuth: NaN, elevation: 0, distance: 1 }), /position/u);
	} finally { gains.close(); }
	assert.throws(() => gains.object({ azimuth: 0, elevation: 0, distance: 1 }), /closed/u);
});

test('a corrupt renderer is rejected before instantiation', async () => {
	await assert.rejects(createEarGainCalculator(new Uint8Array([0, 1, 2]), '5.1'), /integrity/u);
});
