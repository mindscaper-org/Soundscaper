/* SPDX-License-Identifier: AGPL-3.0-only */
import { aepView } from './aep-container.ts';
import { aepNamed, aepNamedNodes, type AepComposition, type AepLayer } from './aep-project-reader.ts';
import { aepScalar, type AepConversionContext } from './aep-motion-transform.ts';
import { readAepShapePath } from './aep-shape-path.ts';
import { motionRectanglePath } from './motion-shape-primitives.ts';
import type { MotionMask } from './motion-composition.ts';
export function convertAepMasks(layer: AepLayer, comp: AepComposition, size: readonly [number, number], context: AepConversionContext): readonly MotionMask[] {
	const parade = aepNamed(layer.properties, 'ADBE Mask Parade'); if (!parade) return [];
	const result: MotionMask[] = [], scope = `item-${String(comp.id)}-layer-${String(layer.id)}`;
	let metadata: DataView | null = null;
	for (const chunk of parade.children ?? []) {
		if (chunk.id === 'mkif') { metadata = aepView(chunk.data, 8); continue; }
		if (chunk.type !== 'tdgp') continue;
		try {
			if (!metadata) throw new TypeError('Native mask mode metadata is missing.');
			const mode = metadata.getUint32(4); if (mode === 0) { metadata = null; continue; }
			const operation = ({ 1: 'add', 2: 'subtract', 3: 'intersect', 6: 'difference' } as const)[mode as 1];
			if (!operation) throw new TypeError('Native Lighten/Darken mask operations require a separate mapping.');
			const entries = aepNamedNodes(chunk), path = aepNamed(entries, 'ADBE Mask Shape');
			const read = (name: string, fallback: number, axis = 0) => aepScalar(entries, name, fallback, 1, axis, layer, comp, context);
			const x = read('ADBE Mask Feather', 0), y = read('ADBE Mask Feather', 0, 1);
			if (result.length >= 1024) throw new RangeError('AEP mask count exceeds its budget.');
			result.push({ id: context.allocateId(), path: path ? readAepShapePath(path, size) : motionRectanglePath({ x: 0, y: 0, width: size[0], height: size[1] }),
				opacity: read('ADBE Mask Opacity', 1), expansion: read('ADBE Mask Offset', 0), inverted: Boolean(metadata.getUint8(0)), operation,
				feather: { kind: 'vector2', value: [x.value, y.value], curves: [x.curve, y.curve], expression: null } });
			context.note(scope, 'ADBE Mask Parade', 'editable-mask', 'Native static mask path and authored numeric channels use Motion mask compositing; compare feather and expansion rendering.', 'editable');
		} catch (error) { context.note(scope, 'ADBE Mask Parade', 'mask', error instanceof Error ? error.message : String(error)); }
		metadata = null;
	}
	return result;
}
