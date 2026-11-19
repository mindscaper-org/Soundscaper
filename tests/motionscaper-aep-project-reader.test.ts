/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readNativeAep } from '../src/common/editor/aep-project-reader.ts';
import { nativeAepFixture, aepFile, aepList, aepComposition, aepLayer, aepSolid } from './helpers/motionscaper-aep-fixture.ts';
test('native AEP reads real format fields and keeps duplicate names separate by item identity', () => {
	const document = readNativeAep(nativeAepFixture());
	assert.deepEqual(document.compositions.map(comp => [comp.id, comp.name]), [[1, 'Duplicate'], [2, 'Duplicate']]);
	assert.deepEqual(document.compositions[0]!.frameRate, { num: 25, den: 1 }); assert.equal(document.compositions[0]!.durationFrames, 125);
	assert.deepEqual(document.compositions[1]!.frameRate, { num: 30000, den: 1001 }); assert.equal(document.compositions[1]!.durationFrames, 150);
	assert.equal(document.compositions[1]!.layers[0]!.sourceId, 1); assert.deepEqual(document.footage[0]!.color, [0.25, 0.5, 0.75, 1]);
	assert.equal(document.compositions[0]!.layers[0]!.properties[0]!.name, 'ADBE Transform Group');
});
test('native AEP rejects duplicate item identities and empty projects instead of silently replacing compositions', () => {
	assert.throws(() => readNativeAep(aepFile([aepList('Fold', [aepComposition(1, 'A', []), aepComposition(1, 'B', [])])])), /identit/iu);
	assert.throws(() => readNativeAep(aepFile([aepList('Fold', [])])), /composition/iu);
});
test('native AEP honors cancellation and refuses zero stretch denominators before conversion', () => {
	const abort = new AbortController(); abort.abort(); assert.throws(() => readNativeAep(nativeAepFixture(), abort.signal), { name: 'AbortError' });
	const layer = aepLayer(10, 3, 'Broken'); new DataView(layer.body.buffer).setUint32(4 + 8 + 108, 0);
	assert.throws(() => readNativeAep(aepFile([aepList('Fold', [aepComposition(1, 'A', [layer]), aepSolid()])])), /stretch/iu);
});
