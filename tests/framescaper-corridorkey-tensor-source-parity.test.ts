/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { resizeAssistanceRgbaToChwFloatV1, type AssistanceVisualCropV1,
	type AssistanceVisualTensorNormalizationV1 } from '../desktop/assistance-onnx-visual-tensors.ts';

const ROOT = new URL('../', import.meta.url);
const RETAINED = 'evidence/corridorkey-production-cpu-sources-2026-10-22/desktop-assistance-onnx-visual-tensors.ts.txt';
type Resize = typeof resizeAssistanceRgbaToChwFloatV1;

async function measuredResize(): Promise<Resize> {
	const report = JSON.parse(await readFile(new URL('evidence/framescaper-corridorkey-production-cpu-candidate.json', ROOT), 'utf8')) as {
		readonly provenance: { readonly processorSources: readonly { readonly path: string; readonly byteLength: number; readonly sha256: string }[] };
	};
	const pin = report.provenance.processorSources.find(source => source.path === RETAINED);
	assert.ok(pin, 'the retained implementation must belong to the measured processor inventory');
	const bytes = await readFile(new URL(RETAINED, ROOT));
	assert.equal(bytes.length, pin.byteLength);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
	const compiled = transformSync(bytes.toString('utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
	const module = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`) as {
		readonly resizeAssistanceRgbaToChwFloatV1: Resize;
	};
	return module.resizeAssistanceRgbaToChwFloatV1;
}

const NORMALIZATIONS: readonly AssistanceVisualTensorNormalizationV1[] = (['rgb', 'bgr'] as const).flatMap(channelOrder => [
	{ channelOrder, scale: 1 / 255, mean: [0, 0, 0] as const, standardDeviation: [1, 1, 1] as const },
	{ channelOrder, scale: 1 / 127.5, mean: [0.481, 0.458, 0.408] as const, standardDeviation: [0.269, 0.261, 0.276] as const },
]);
const CROPS: readonly AssistanceVisualCropV1[] = [
	{ left: 0, top: 0, right: 1, bottom: 1 },
	{ left: 0.125, top: 0.25, right: 0.875, bottom: 0.9 },
	{ left: 0, top: 0, right: 0.000001, bottom: 0.000001 },
	{ left: 0.999999, top: 0.999999, right: 1, bottom: 1 },
];

test('current direct tensor writes are bit-identical to the authenticated measured implementation', async () => {
	const measured = await measuredResize();
	for (const [width, height, targetWidth, targetHeight] of [
		[1, 1, 1, 1], [1, 7, 5, 3], [7, 1, 3, 5], [3, 5, 11, 13], [17, 13, 4, 3], [65, 61, 31, 29],
	] as const) {
		for (const pattern of [0, 1, 2]) {
			const rgba = Uint8Array.from({ length: width * height * 4 }, (_, index) =>
				pattern === 0 ? index * 73 % 256 : pattern === 1 ? index % 2 * 255 : index * index * 31 % 256);
			for (const normalization of NORMALIZATIONS) for (const crop of CROPS) {
				const args = [rgba, width, height, targetWidth, targetHeight, normalization, crop] as const;
				const current = resizeAssistanceRgbaToChwFloatV1(...args), original = measured(...args);
				assert.equal(current.length, targetWidth * targetHeight * 3);
				assert.deepEqual(Buffer.from(current.buffer, current.byteOffset, current.byteLength),
					Buffer.from(original.buffer, original.byteOffset, original.byteLength),
					JSON.stringify({ width, height, targetWidth, targetHeight, pattern, normalization, crop }));
			}
		}
	}
});

test('current and measured tensor preparation retain the same geometry and crop refusals', async () => {
	const measured = await measuredResize(), normalization = NORMALIZATIONS[0]!;
	const valid = [new Uint8Array(16), 2, 2, 3, 3, normalization] as const;
	const invalid: readonly Parameters<Resize>[] = [
		[new Uint8Array(15), 2, 2, 3, 3, normalization],
		[new Uint8Array(16), 2, 2, 0, 3, normalization],
		[new Uint8Array(16), 2, 2, 4_097, 3, normalization],
		[new Uint8Array(16), 2, 2, 1.5, 3, normalization],
		[...valid, { left: -0.1, top: 0, right: 1, bottom: 1 }],
		[...valid, { left: 0, top: NaN, right: 1, bottom: 1 }],
		[...valid, { left: 1, top: 0, right: 1, bottom: 1 }],
		[...valid, { left: 0, top: 0.5, right: 1, bottom: 0.25 }],
	];
	for (const args of invalid) {
		let expected: unknown;
		try { measured(...args); } catch (error) { expected = error; }
		assert.ok(expected instanceof RangeError);
		assert.throws(() => resizeAssistanceRgbaToChwFloatV1(...args), { name: expected.name, message: expected.message });
	}
});
