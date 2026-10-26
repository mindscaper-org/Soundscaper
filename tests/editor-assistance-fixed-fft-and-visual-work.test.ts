/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createAssistanceBeatThisLogMelV1 } from '../src/common/editor/assistance/beat-this-log-mel-v1.ts';
import { resizeAssistanceRgbaToChwFloatV1 } from '../desktop/assistance-onnx-visual-tensors.ts';

function hash(value: Float32Array): string { return createHash('sha256').update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).digest('hex'); }

test('Beat This reuses exact fixed FFT roots with bit-identical public log-mel output', async context => {
	const samples = Float32Array.from({ length: 22_050 }, (_, index) => Math.fround(Math.sin(index / 37) * 0.25 + Math.cos(index / 11) * 0.125));
	const sine = Math.sin; const cosine = Math.cos; let trigonometry = 0;
	context.mock.method(Math, 'sin', (value: number) => { trigonometry += 1; return sine(value); });
	context.mock.method(Math, 'cos', (value: number) => { trigonometry += 1; return cosine(value); });
	const result = await createAssistanceBeatThisLogMelV1(samples);
	assert.equal(hash(result.values), '86c728cc8ec21cafecbeb35625b08c586e722139273f61a398767112cdbb3624');
	assert.equal(trigonometry, 0, 'the fixed FFT stage roots are prepared outside the recurring model ranges');
});

test('BGR model resizing and cropped normalized RGB write identical tensors without per-pixel arrays', context => {
	const rgba = Uint8Array.from({ length: 320 * 180 * 4 }, (_, index) => (index * 17 + 31) % 256);
	const freeze = Object.freeze; let rgbArrays = 0;
	context.mock.method(Object, 'freeze', <Value>(value: Value): Readonly<Value> => { if (Array.isArray(value) && value.length === 3) rgbArrays += 1; return freeze(value); });
	const bgr = resizeAssistanceRgbaToChwFloatV1(rgba, 320, 180, 640, 640, { channelOrder: 'bgr', scale: 1, mean: [104, 117, 123], standardDeviation: [1, 1, 1] });
	const rgb = resizeAssistanceRgbaToChwFloatV1(rgba, 320, 180, 31, 37, { channelOrder: 'rgb', scale: 1 / 255, mean: [0.485, 0.456, 0.406], standardDeviation: [0.229, 0.224, 0.225] }, { left: 0.1, top: 0.15, right: 0.8, bottom: 0.95 });
	assert.equal(hash(bgr), 'c70b58ed3475c6bffe13707f8c2cca7450210a49fb1e8f5e6fb709d5663ad586');
	assert.equal(hash(rgb), '8a0683783e46bc1813c4170e089b4ce12ef90db2b84fc75a4ddcaf9f3a0142fc');
	assert.equal(rgbArrays, 0, 'interpolated channels go directly to the owned tensor');
});
