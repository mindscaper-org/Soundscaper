/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyImageFormatSignature } from '../src/common/imaging/image-format-signature.ts';
import { admitImageImportGesture } from '../src/common/imaging/image-import-admission.ts';
import { parseCubeLutV1 } from '../src/common/imaging/cube-lut-v1.ts';

test('image resource admission refuses malformed records, inherited arrays, and accessor side effects', () => {
	const inherited = Object.create({ fileByteLengths: [1] }) as unknown;
	for (const request of [null, [], new Date(), inherited, { unknown: true }, {}]) {
		assert.throws(() => admitImageImportGesture(request), /plain object|Unknown|required|data field/u);
	}
	let getterCalls = 0;
	const accessor = { get fileByteLengths() { getterCalls++; return [1]; } };
	assert.throws(() => admitImageImportGesture(accessor), /data properties/u);
	assert.equal(getterCalls, 0);
	const foreignArray = Object.setPrototypeOf([1], null) as unknown;
	for (const lengths of [undefined, {}, foreignArray, new Array<unknown>(1), Object.assign([1], { metadata: true })]) {
		assert.throws(() => admitImageImportGesture({ fileByteLengths: lengths }), /array|dense|indexed/u);
	}
	const arrayAccessor = Object.defineProperty([1], '0', { get() { getterCalls++; return 1; } });
	assert.throws(() => admitImageImportGesture({ fileByteLengths: arrayAccessor }), /ordinary data/u);
	assert.equal(getterCalls, 0);
});

test('byte signatures recognize legacy core DIB geometry without a decoder or filename', () => {
	const bytes = new Uint8Array(12);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 12, true);
	view.setUint16(4, 2, true);
	view.setUint16(6, 1, true);
	view.setUint16(8, 1, true);
	view.setUint16(10, 24, true);
	assert.deepEqual(classifyImageFormatSignature(bytes), { status: 'recognized', format: 'dib' });
	assert.throws(() => classifyImageFormatSignature(new ArrayBuffer(12) as never), /Uint8Array/u);
});

test('cube LUT resources refuse empty bodies and zero-width component domains', () => {
	assert.throws(() => parseCubeLutV1(''), /byte bound/u);
	const body = 'LUT_3D_SIZE 2\nDOMAIN_MIN 1 0 0\nDOMAIN_MAX 1 1 1\n' + '0 0 0\n'.repeat(8);
	assert.throws(() => parseCubeLutV1(body), /minimum must precede/u);
});
