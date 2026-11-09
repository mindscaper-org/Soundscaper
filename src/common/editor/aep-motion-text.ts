/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AepLayer, AepComposition } from './aep-project-reader.ts';
import { readAepText } from './aep-text-reader.ts';
import type { AepConversionContext } from './aep-motion-transform.ts';
import type { MotionAsset } from './motion-asset.ts';
import type { MotionLayerContent } from './motion-composition.ts';
import { motionColor, motionScalar, motionVector, type MotionVector3Property } from './motion-property.ts';
import { decodeMotionChannel } from './motion-surface.ts';
export interface NativeAepFontBinding { readonly postScriptName: string; readonly asset: Extract<MotionAsset, { kind: 'font' }> }
export function offsetAepTextAnchor(anchor: MotionVector3Property, offset: readonly [number, number]): MotionVector3Property {
	const value = anchor.value.map((value, axis) => value - (offset[axis] ?? 0)) as unknown as MotionVector3Property['value'];
	const curves = anchor.curves.map((curve, axis) => {
		const amount = offset[axis] ?? 0; if (!curve || !amount) return curve;
		return { anchors: curve.anchors.map(point => ({ ...point, value: point.value - amount })), segments: curve.segments.map(shape => shape.kind === 'bezier' ? {
			...shape, control1: { ...shape.control1, value: shape.control1.value - amount }, control2: { ...shape.control2, value: shape.control2.value - amount },
		} : shape) };
	}) as unknown as MotionVector3Property['curves'];
	return { ...anchor, value, curves };
}
export function convertAepText(layer: AepLayer, comp: AepComposition, fonts: readonly NativeAepFontBinding[], context: AepConversionContext): Readonly<{ content: MotionLayerContent; offset: readonly [number, number] }> {
	const scope = `item-${String(comp.id)}-layer-${String(layer.id)}`;
	try {
		const text = readAepText(layer); if (!text) throw new TypeError('Native text document is missing.');
		for (const message of text.limitations) context.note(scope, 'Source Text', 'text-layout', message);
		const runs = text.runs.map(run => {
			const font = fonts.find(font => font.postScriptName === run.font); if (!font) throw new TypeError(`Select a font file for PostScript face ${run.font}.`);
			return { text: run.text, fontAssetId: font.asset.id, fontSize: motionScalar(run.size), tracking: motionScalar(run.tracking), color: motionColor([decodeMotionChannel(run.argb[1]!, 'srgb'), decodeMotionChannel(run.argb[2]!, 'srgb'), decodeMotionChannel(run.argb[3]!, 'srgb'), run.argb[0]!]) };
		});
		if (!text.box) context.note(scope, 'Source Text', 'point-text', 'Point text is reflowed in a composition-sized editable box. Its baseline and bounds need visual review.');
		const box = text.box ?? [0, -text.runs[0]!.size, comp.width, comp.height - text.runs[0]!.size] as const;
		context.note(scope, 'Source Text', 'editable-text', 'Native text characters and basic style runs use explicitly selected font files.', 'editable');
		return { content: { kind: 'text', document: { runs, align: ({ 0: 'left', 1: 'right', 2: 'center' } as const)[text.align as 0] ?? 'justify', lineHeight: motionScalar(text.lineHeight), boxSize: motionVector([box[2] - box[0], box[3] - box[1]]) } }, offset: [box[0], box[1]] };
	} catch (error) {
		context.note(scope, 'Source Text', 'text', error instanceof Error ? error.message : String(error)); return { content: { kind: 'null' }, offset: [0, 0] };
	}
}
