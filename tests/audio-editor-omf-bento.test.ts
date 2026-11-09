/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readOmfBento, writeOmfBento } from '../src/common/editor/omf-bento.ts';

test('Bento2 stores globally named OMF properties and persistent references', () => {
	const bytes = writeOmfBento([
		{ object: 1, property: 'OMFI:OOBJ:ObjClass', type: 'omfi:ClassID', bytes: new TextEncoder().encode('HEAD') },
		{ object: 1, property: 'OMFI:HEAD:Mobs', type: 'omfi:ObjRefArray', bytes: Uint8Array.of(1, 0, 64, 0, 0, 0), references: [64] },
		{ object: 64, property: 'OMFI:OOBJ:ObjClass', type: 'omfi:ClassID', bytes: new TextEncoder().encode('CMOB') },
	]);
	assert.deepEqual(Array.from(bytes.slice(-24, -16)), [0xa4, 0x43, 0x4d, 0xa5, 0x48, 0x64, 0x72, 0xd7]);
	const file = readOmfBento(bytes);
	assert.equal(file.text(1, 'OMFI:OOBJ:ObjClass'), 'HEAD');
	assert.deepEqual(file.refs(1, 'OMFI:HEAD:Mobs', true), [64]);
	assert.equal(file.text(64, 'OMFI:OOBJ:ObjClass'), 'CMOB');
});

test('Bento reader refuses truncated labels, bad TOC bounds, and undefined references', () => {
	assert.throws(() => readOmfBento(Uint8Array.of(1, 2, 3)), /Bento/u);
	const bytes = writeOmfBento([{ object: 1, property: 'OMFI:HEAD:Version', type: 'omfi:VersionType', bytes: Uint8Array.of(2, 0) }]);
	new DataView(bytes.buffer).setUint32(bytes.length - 8, bytes.length + 1, true);
	assert.throws(() => readOmfBento(bytes), /TOC/u);
	const missing = readOmfBento(writeOmfBento([{ object: 1, property: 'OMFI:HEAD:Mobs', type: 'omfi:ObjRefArray', bytes: Uint8Array.of(1, 0, 64, 0, 0, 0), references: [64] }]));
	assert.throws(() => missing.refs(1, 'OMFI:HEAD:Mobs', true), /Undefined/u);
});

test('OMF numeric property byte order is independent from Bento container byte order', () => {
	const file = readOmfBento(writeOmfBento([
		{ object: 1, property: 'OMFI:HEAD:ByteOrder', type: 'omfi:Int16', bytes: Uint8Array.of(0x4d, 0x4d) },
		{ object: 64, property: 'OMFI:CPNT:Length', type: 'omfi:Length32', bytes: Uint8Array.of(0, 0, 0xbb, 0x80) },
		{ object: 64, property: 'OMFI:WAVD:Summary', type: 'omfi:DataValue', bytes: new Uint8Array() },
	]));
	assert.equal(file.littleEndian, true);
	assert.equal(file.dataLittleEndian, false);
	assert.equal(file.integer(64, 'OMFI:CPNT:Length'), 48_000);
	assert.equal(file.value(64, 'OMFI:WAVD:Summary')?.length, 0);
});
