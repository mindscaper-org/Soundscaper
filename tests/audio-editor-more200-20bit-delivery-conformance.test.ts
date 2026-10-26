/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { assertDeliveryConformance, conformDeliveredAudio, type DeliveredByteSource } from '../src/common/editor/delivery-conformance.ts';

const channels = [Float32Array.of(0, .25, -.5), Float32Array.of(.125, -.25, .5)];
const inspect = async (source: DeliveredByteSource) => await inspectWavBlobPcm(source);

for (const format of ['wav', 'bwf']) test(`${format}20bit delivery reopens its20valid bits in a24bit container`, async () => {
	const bytes = encodeWav(channels, { bitDepth: 20, dither: false, ...(format === 'bwf' ? { bext: { description: '20-bit master' } } : {}) });
	const blob = new Blob([new Uint8Array(bytes)]); const descriptor = await inspectWavBlobPcm(blob);
	assert.equal(descriptor.bitDepth, 24); assert.equal(descriptor.validBitsPerSample, 20);
	const findings = await conformDeliveredAudio({ format, outputFrames: 3, sampleRate: 48_000, channelCount: 2,
		encoding: { sampleFormat: 'int20' } }, blob, { inspect });
	const sample = findings.find(finding => finding.code === 'delivery.conformance-sample-format');
	assert.equal(sample?.severity, 'info'); assert.equal(sample.data.actual, 'int20');
	assert.doesNotThrow(() => assertDeliveryConformance(findings));
});

test('a genuinely24bit delivery cannot satisfy a20bit plan', async () => {
	const blob = new Blob([new Uint8Array(encodeWav(channels, { bitDepth: 24, dither: false }))]);
	const findings = await conformDeliveredAudio({ format: 'wav', outputFrames: 3, sampleRate: 48_000, channelCount: 2,
		encoding: { sampleFormat: 'int20' } }, blob, { inspect });
	assert.equal(findings.find(finding => finding.code === 'delivery.conformance-sample-format')?.severity, 'error');
	assert.throws(() => assertDeliveryConformance(findings), /sampleFormat is int24/u);
});

test('ordinary24bit delivery keeps its existing sample format', async () => {
	const blob = new Blob([new Uint8Array(encodeWav(channels, { bitDepth: 24, dither: false }))]);
	const findings = await conformDeliveredAudio({ format: 'wav', outputFrames: 3, sampleRate: 48_000, channelCount: 2,
		encoding: { sampleFormat: 'int24' } }, blob, { inspect });
	assert.doesNotThrow(() => assertDeliveryConformance(findings));
});
