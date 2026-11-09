/* SPDX-License-Identifier: AGPL-3.0-only */
import { aepChild, aepView, type AepChunk } from './aep-container.ts';
import { aepFinite } from './aep-project-reader.ts';
import type { MotionPathProperty, MotionVector2 } from './motion-property.ts';
/** The native shape box includes handles. Mask coordinates additionally use source pixels. */
export function readAepShapePath(property: AepChunk, size: MotionVector2 = [1, 1]): MotionPathProperty {
	const keys = aepChild(property, 'omks'), shapes = keys?.children?.filter(chunk => chunk.type === 'shap') ?? [];
	if (shapes.length !== 1) throw new TypeError('Animated or absent AEP paths require a separate mapping.');
	const shape = shapes[0]!, raw = aepChild(shape, 'shph'), list = aepChild(shape, 'list');
	const header = raw && aepView(raw.data, 21), meta = list && aepChild(list, 'lhd3'), points = list && aepChild(list, 'ldat');
	if (!header || !meta || !points) throw new TypeError('AEP path records are incomplete.');
	const view = aepView(meta.data, 20), count = view.getUint32(8);
	if (view.getUint32(0) !== 0xd00bee || view.getUint32(16) !== 8 || count < 6 || count % 3 || count > 12_288 || points.data.length !== count * 8) throw new RangeError('AEP path exceeds its record budget.');
	const box = [4, 8, 12, 16].map(at => aepFinite(header.getFloat32(at))), data = aepView(points.data, count * 8);
	const point = (index: number): MotionVector2 => [aepFinite((box[0]! + data.getFloat32(index * 8) * (box[2]! - box[0]!)) * size[0]), aepFinite((box[1]! + data.getFloat32(index * 8 + 4) * (box[3]! - box[1]!)) * size[1])];
	const vertices = Array.from({ length: count / 3 }, (_, index) => {
		const p = point(index * 3), incoming = point(index ? index * 3 - 1 : count - 1), outgoing = point(index * 3 + 1);
		return { point: p, inTangent: [incoming[0] - p[0], incoming[1] - p[1]] as MotionVector2, outTangent: [outgoing[0] - p[0], outgoing[1] - p[1]] as MotionVector2 };
	});
	return { kind: 'path', value: { closed: !(header.getUint8(3) & 8), vertices }, keyframes: [], segments: [], expression: null };
}
