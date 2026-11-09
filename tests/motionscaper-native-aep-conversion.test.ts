/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertNativeAep } from '../src/common/editor/aep-motion-conversion.ts';
import { readNativeAep } from '../src/common/editor/aep-project-reader.ts';
import { digestBytes } from '../src/common/media/bytes.ts';
import { evaluateInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import { nativeAepFixture, aepFile, aepList, aepComposition, aepLayer, aepSolid, aepNamed, aepNumeric, aepChunk, aepBytes } from './helpers/motionscaper-aep-fixture.ts';
function convert(bytes = nativeAepFixture()) {
	const sha256 = digestBytes(bytes); let index = 0;
	return convertNativeAep(readNativeAep(bytes), { projectId: 'native-project', title: 'Native.aep', allocateId: () => `native-${String(++index)}`,
		source: { kind: 'attachment', id: 'original-aep', name: 'Native.aep', mimeType: 'application/vnd.adobe.aftereffects.project', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: bytes.length }, media: [] });
}
test('native AEP conversion creates editable solids, independent composition IDs and authored opacity keys', () => {
	const project = convert(), comp = project.compositions[0]!, layer = comp.layers[0]!;
	assert.equal(layer.kind, 'solid'); assert.deepEqual(layer.transform.position.value, [32, 24, 0]); assert.deepEqual(layer.transform.anchor.value, [32, 24, 0]);
	assert.equal(evaluateInterpolationCurve(layer.transform.opacity.curve!, 12.5), 0.75);
	assert.deepEqual(comp.frameRate, { num: 25, den: 1 }); assert.equal(comp.durationFrames, 125);
	const nested = project.compositions[1]!.layers[0]!; if (nested.kind !== 'precomp') throw new Error('Expected precomp.');
	assert.equal(nested.compositionId, comp.id); assert.notEqual(comp.id, project.compositions[1]!.id);
	assert.equal(project.nativeImport?.sourceAssetId, 'original-aep'); assert.equal(project.assets[0]!.kind, 'attachment');
	assert.ok(project.nativeImport?.report.some(row => row.code === 'native-aep' && row.status === 'editable'));
});
test('native shape rectangles retain duplicate occurrences, group translation, linear color and stroke defaults', () => {
	const contents = [...aepNamed('ADBE Vector Shape - Rect', aepList('tdgp', aepNumeric('ADBE Vector Rect Size', [20, 10]))),
		...aepNamed('ADBE Vector Shape - Rect', aepList('tdgp', aepNumeric('ADBE Vector Rect Position', [40, 0]))),
		...aepNamed('ADBE Vector Graphic - Fill', aepList('tdgp', aepNumeric('ADBE Vector Fill Color', [255, 255, 0, 0]))),
		...aepNamed('ADBE Vector Graphic - Stroke', aepList('tdgp', []))];
	const group = aepList('tdgp', [...aepNamed('ADBE Vectors Group', aepList('tdgp', contents)), ...aepNamed('ADBE Vector Transform Group', aepList('tdgp', aepNumeric('ADBE Vector Position', [5, 7])))]);
	const root = aepNamed('ADBE Root Vectors Group', aepList('tdgp', aepNamed('ADBE Vector Group', group)));
	const project = convert(aepFile([aepList('Fold', [aepComposition(1, 'Shapes', [aepLayer(10, 0, 'Shapes', [], 0, root, 4)])])]));
	const layer = project.compositions[0]!.layers[0]!; assert.equal(layer.kind, 'shapes'); if (layer.kind !== 'shapes') return;
	assert.equal(layer.shapes.length, 2); assert.notEqual(layer.shapes[0]!.id, layer.shapes[1]!.id);
	assert.deepEqual(layer.shapes[0]!.path.value.vertices[0]!.point, [-5, 2]);
	assert.deepEqual(layer.shapes[1]!.path.value.vertices[0]!.point, [-5, -43]);
	assert.equal(layer.shapes[0]!.stroke?.width.value, 2); assert.equal(layer.shapes[0]!.fill?.kind, 'color');
});
test('native AEP refuses cyclic precompositions and duplicate layer identities without publishing a partial project', () => {
	assert.throws(() => convert(aepFile([aepList('Fold', [aepComposition(1, 'A', [aepLayer(10, 2, 'B')]), aepComposition(2, 'B', [aepLayer(20, 1, 'A')])])])), /cycle/iu);
	assert.throws(() => convert(aepFile([aepList('Fold', [aepComposition(1, 'A', [aepLayer(10, 3, 'One'), aepLayer(10, 3, 'Two')]), aepSolid()])])), /identit/iu);
});
test('native masks keep occurrence-specific modes and apply the native source rectangle default', () => {
	const masks = aepNamed('ADBE Mask Parade', aepList('tdgp', [aepChunk('mkif', aepBytes(12, view => { view.setUint8(0, 1); view.setUint32(4, 2); })),
		...aepNamed('ADBE Mask Atom', aepList('tdgp', aepNumeric('ADBE Mask Opacity', [0.5])))]));
	const layer = convert(aepFile([aepList('Fold', [aepComposition(1, 'Masks', [aepLayer(10, 3, 'Masked', [], 0, masks)]), aepSolid()])])).compositions[0]!.layers[0]!;
	assert.equal(layer.masks.length, 1); assert.equal(layer.masks[0]!.operation, 'subtract'); assert.equal(layer.masks[0]!.inverted, true);
	assert.equal(layer.masks[0]!.opacity.value, 0.5); assert.deepEqual(layer.masks[0]!.path.value.vertices.map(vertex => vertex.point), [[0, 0], [64, 0], [64, 48], [0, 48]]);
});
test('native track mattes evaluate a hidden source through an independent editable copy', () => {
	const source = aepLayer(10, 3, 'Matte'), consumer = aepLayer(20, 3, 'Consumer');
	new DataView(source.body.buffer).setUint8(12 + 39, 6);
	const target = new DataView(consumer.body.buffer); target.setUint8(12 + 107, 1); target.setUint32(12 + 160, 10);
	const layers = convert(aepFile([aepList('Fold', [aepComposition(1, 'Mattes', [source, consumer]), aepSolid()])])).compositions[0]!.layers;
	assert.equal(layers.length, 3); assert.equal(layers[0]!.enabled, false); assert.equal(layers[2]!.enabled, true);
	assert.equal(layers[1]!.matte?.layerId, layers[2]!.id); assert.notEqual(layers[1]!.matte?.layerId, layers[0]!.id);
});
test('default separated-axis records never suppress authored combined Position keys', () => {
	const x = aepNumeric('ADBE Position_0', [0]), y = aepNumeric('ADBE Position_1', [0]);
	for (const entry of [x, y]) new DataView(entry[1]!.body.buffer).setUint32(12, 3);
	const properties = [...aepNumeric('ADBE Position', [10, 20, 0], [{ time: 0, value: [10, 20, 0] }, { time: 25600, value: [30, 40, 0] }]), ...x, ...y];
	const layer = convert(aepFile([aepList('Fold', [aepComposition(1, 'Position', [aepLayer(10, 3, 'Animated', properties)]), aepSolid()])])).compositions[0]!.layers[0]!;
	assert.equal(evaluateInterpolationCurve(layer.transform.position.curves[0]!, 12.5), 20);
	assert.equal(evaluateInterpolationCurve(layer.transform.position.curves[1]!, 12.5), 30);
});
test('authored native separated Position axes replace the stale combined leader', () => {
	const properties = [...aepNumeric('ADBE Position', [999, 999, 0]), ...aepNumeric('ADBE Position_0', [10], [{ time: 0, value: [10], hold: true }, { time: 25600, value: [30] }]), ...aepNumeric('ADBE Position_1', [20])];
	const layer = convert(aepFile([aepList('Fold', [aepComposition(1, 'Separated', [aepLayer(10, 3, 'Animated', properties)]), aepSolid()])])).compositions[0]!.layers[0]!;
	assert.deepEqual(layer.transform.position.value, [10, 20, 0]); assert.equal(evaluateInterpolationCurve(layer.transform.position.curves[0]!, 12.5), 10);
});
test('authored constant Time Remapping freezes source time rather than reverting to source playback', () => {
	const remap = aepNumeric('ADBE Time Remapping', [2]);
	const project = convert(aepFile([aepList('Fold', [aepComposition(1, 'Time', [aepLayer(10, 2, 'Frozen', [], 0, remap)]), aepComposition(2, 'Nested', [])])]));
	assert.equal(project.compositions[0]!.layers[0]!.timeRemap?.value, 2); assert.equal(project.compositions[0]!.layers[0]!.timeRemap?.curve, null);
});
