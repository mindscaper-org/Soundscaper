/* SPDX-License-Identifier: AGPL-3.0-only */
import { aepNamed, aepNamedNodes, type AepComposition, type AepLayer, type AepNamedNode } from './aep-project-reader.ts';
import { readAepNumeric, aepNumericCurve, type AepReadBudget } from './aep-property-reader.ts';
import type { AepChunk } from './aep-container.ts';
import type { AepNumeric } from './aep-property-reader.ts';
import type { MotionNativeImportEntry } from './motion-native-import-custody.ts';
import type { MotionTransform } from './motion-composition.ts';
import { motionScalar, type MotionScalarProperty } from './motion-property.ts';
export interface AepConversionContext {
	readonly budget: AepReadBudget; readonly report: MotionNativeImportEntry[]; readonly allocateId: () => string;
	readonly numeric: WeakMap<AepChunk, AepNumeric | null>;
	note(scopeId: string, path: string, code: string, message: string, status?: MotionNativeImportEntry['status']): void;
}
export function aepNumber(entries: readonly AepNamedNode[], name: string, context: AepConversionContext): AepNumeric | null {
	const chunk = aepNamed(entries, name); if (!chunk) return null;
	if (context.numeric.has(chunk)) return context.numeric.get(chunk)!;
	const value = readAepNumeric(chunk, context.budget); context.numeric.set(chunk, value); return value;
}
export function aepScalar(entries: readonly AepNamedNode[], name: string, fallback: number, units: number, axis: number,
	layer: AepLayer, comp: AepComposition, context: AepConversionContext): MotionScalarProperty {
	const scope = `item-${String(comp.id)}-layer-${String(layer.id)}`;
	try {
		const source = aepNumber(entries, name, context);
		if (!source) return motionScalar(fallback);
		if (source.value[axis] === undefined) throw new TypeError('AEP numeric channel dimensions do not match the property.');
		if (source.expressionEnabled) context.note(scope, name, 'expression', 'The After Effects expression is retained in the original project and remains disabled. Authored values and keys are imported.');
		let curve = null;
		try { curve = aepNumericCurve(source, axis, units, { start: layer.start, stretch: layer.stretch, rate: comp.storedRate }); }
		catch (error) { context.note(scope, name, 'animation', error instanceof Error ? error.message : 'This AEP animation needs a separate mapping.'); }
		return { kind: 'scalar', value: source.value[axis]! * units, curve, expression: null };
	} catch (error) {
		if (error instanceof RangeError) throw error;
		context.note(scope, name, 'property', error instanceof Error ? error.message : 'This AEP property is unsupported.'); return motionScalar(fallback);
	}
}
export function convertAepTransform(layer: AepLayer, comp: AepComposition, sourceSize: readonly [number, number], context: AepConversionContext): MotionTransform {
	const entries = aepNamedNodes(aepNamed(layer.properties, 'ADBE Transform Group'));
	const read = (name: string, fallback: number, units = 1, axis = 0) => aepScalar(entries, name, fallback, units, axis, layer, comp, context);
	const vector = (channels: readonly [MotionScalarProperty, MotionScalarProperty, MotionScalarProperty]): MotionTransform['position'] => ({
		kind: 'vector3', value: [channels[0].value, channels[1].value, channels[2].value], curves: [channels[0].curve, channels[1].curve, channels[2].curve], expression: null,
	});
	const hasSource = !layer.nullLayer && layer.kind === 0;
	const anchorDefault = hasSource ? [sourceSize[0] / 2, sourceSize[1] / 2, 0] : [0, 0, 0];
	const anchor = vector([read('ADBE Anchor Point', anchorDefault[0]!, hasSource ? sourceSize[0] : 1, 0), read('ADBE Anchor Point', anchorDefault[1]!, hasSource ? sourceSize[1] : 1, 1), read('ADBE Anchor Point', 0, 1, 2)]);
	// AE also writes inactive default-state axis records beside ordinary combined Position.
	const separated = ['ADBE Position_0', 'ADBE Position_1', 'ADBE Position_2'].some(name => aepNumber(entries, name, context) !== null);
	const position = vector([0, 1, 2].map(axis => axis === 2 && !layer.threeD ? motionScalar(0) : read(separated ? `ADBE Position_${String(axis)}` : 'ADBE Position', axis === 0 ? comp.width / 2 : axis === 1 ? comp.height / 2 : 0, 1, separated ? 0 : axis)) as [MotionScalarProperty, MotionScalarProperty, MotionScalarProperty]);
	const known = new Set(['ADBE Anchor Point', 'ADBE Position', 'ADBE Position_0', 'ADBE Position_1', 'ADBE Position_2', 'ADBE Scale', 'ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Rotate Z', 'ADBE Opacity']);
	for (const entry of entries) if (!known.has(entry.name)) context.note(`item-${String(comp.id)}-layer-${String(layer.id)}`, entry.name, 'transform', 'This transform channel is retained in the original AEP and is not mapped.');
	return { anchor, position, scale: vector([read('ADBE Scale', 1, 1, 0), read('ADBE Scale', 1, 1, 1), layer.threeD ? read('ADBE Scale', 1, 1, 2) : motionScalar(1)]),
		rotation: vector([read('ADBE Rotate X', 0), read('ADBE Rotate Y', 0), read('ADBE Rotate Z', 0)]), opacity: read('ADBE Opacity', 1) };
}
