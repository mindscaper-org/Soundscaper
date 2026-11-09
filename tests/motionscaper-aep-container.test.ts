/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAepContainer, AEP_LIMITS, aepChild } from '../src/common/editor/aep-container.ts';
import { aepFile, aepList, aepChunk, aepString, aepChunks } from './helpers/motionscaper-aep-fixture.ts';

test('native AEP reads big-endian RIFX lists, odd payloads and opaque text without executing the trailer', () => {
	const source = aepFile([aepList('Fold', [aepList('Item', [aepString('One')])]), aepList('btdk', []), aepChunk('data', new Uint8Array([1, 2, 3]))], '<?xpacket never execute?>');
	const parsed = parseAepContainer(source);
	assert.equal(parsed[0]!.type, 'Fold'); assert.equal(parsed[0]!.children![0]!.type, 'Item');
	assert.equal(new TextDecoder().decode(parsed[0]!.children![0]!.children![0]!.data), 'One');
	assert.equal(parsed[1]!.children, null); assert.deepEqual(parsed[2]!.data, new Uint8Array([1, 2, 3]));
	source.fill(0); assert.equal(parsed[0]!.type, 'Fold');
});
test('native AEP refuses ambiguous singleton records', () => {
	const chunks = parseAepContainer(aepFile([aepList('Item', [aepChunk('idta', new Uint8Array()), aepChunk('idta', new Uint8Array())])]));
	assert.throws(() => aepChild(chunks[0]!, 'idta'), /duplicat/iu);
});
test('native AEP refuses damaged containers and critical lists before exposing partial project content', () => {
	const valid = aepFile([aepList('Fold', [])]);
	for (const input of [new Uint8Array(), valid.subarray(0, 11), valid.subarray(0, valid.length - 1), aepFile([aepList('Fold', [aepChunk('bad!', new Uint8Array(1))])]).subarray(0, 24)]) {
		assert.throws(() => parseAepContainer(input), /AEP/iu);
	}
	const wrong = new Uint8Array(valid); wrong[0] = 0; assert.throws(() => parseAepContainer(wrong), /RIFX/iu);
	const broken = aepFile([aepChunk('LIST', new Uint8Array([...new TextEncoder().encode('Fold'), 1, 2, 3]))]);
	assert.throws(() => parseAepContainer(broken), /chunk|structure/iu);
	assert.throws(() => parseAepContainer(new Uint8Array(AEP_LIMITS.bytes + 1)), /budget/iu);
});
test('native AEP bounds nesting and chunk count and keeps unknown opaque lists', () => {
	let nested = aepList('Fold', []); for (let index = 0; index < AEP_LIMITS.depth + 1; index++) nested = aepList('Fold', [nested]);
	assert.throws(() => parseAepContainer(aepFile([nested])), /depth/iu);
	const opaque = parseAepContainer(aepFile([aepChunk('LIST', new Uint8Array([...new TextEncoder().encode('priv'), 7, 8, 9]))]));
	assert.equal(opaque[0]!.type, 'priv'); assert.equal(opaque[0]!.children, null);
	const oversized = aepFile([aepChunk('data', new Uint8Array())]); new DataView(oversized.buffer).setUint32(16, 0xffffffff);
	assert.throws(() => parseAepContainer(oversized), /chunk/iu);
	assert.equal(aepChunks([]).length, 0);
});
