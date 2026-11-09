/* SPDX-License-Identifier: AGPL-3.0-only */
import { aepChild, aepView, type AepChunk } from './aep-container.ts';
import { aepNamed, aepNamedNodes, type AepNamedNode } from './aep-project-reader.ts';
import { aepNumber, type AepConversionContext } from './aep-motion-transform.ts';
import { readAepShapePath } from './aep-shape-path.ts';
import type { MotionLayerContent, MotionShape } from './motion-composition.ts';
import { motionEllipsePath, motionPolygonPath, motionRectanglePath } from './motion-shape-primitives.ts';
import { motionColor, motionScalar, type MotionPathProperty, type MotionVector2 } from './motion-property.ts';
import { decodeMotionChannel } from './motion-surface.ts';
type Matrix = readonly [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
function product(a: Matrix, b: Matrix): Matrix {
	return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function transform(path: MotionPathProperty, matrix: Matrix): MotionPathProperty {
	const vector = ([x, y]: MotionVector2, translate = false): MotionVector2 => [matrix[0] * x + matrix[2] * y + (translate ? matrix[4] : 0), matrix[1] * x + matrix[3] * y + (translate ? matrix[5] : 0)];
	return { ...path, value: { ...path.value, vertices: path.value.vertices.map(vertex => ({ point: vector(vertex.point, true), inTangent: vector(vertex.inTangent), outTangent: vector(vertex.outTangent) })) } };
}
/** Flatten a static vector hierarchy into ordinary editable paths, retaining every unsupported operator in source custody. */
export function convertAepShapes(root: AepChunk, scope: string, context: AepConversionContext): MotionLayerContent {
	const shapes: MotionShape[] = [];
	const note = (path: string, message: string) => context.note(scope, path, 'shape', message);
	const read = (entries: readonly AepNamedNode[], name: string, fallback: readonly number[]): readonly number[] => {
		const property = aepNumber(entries, name, context); if (!property) return fallback;
		if (property.keys.length || property.expressionEnabled) note(name, 'Shape animation and expressions remain in the original AEP; this editable path uses its authored initial value.');
		return property.value;
	};
	const scalar = (entries: readonly AepNamedNode[], name: string, fallback: number) => read(entries, name, [fallback])[0]!;
	function color(entries: readonly AepNamedNode[], prefix: string, fallback: readonly number[], alpha: number) {
		const value = read(entries, `${prefix} Color`, fallback);
		if (value.length !== 4) throw new TypeError('AEP shape color needs ARGB channels.');
		return motionColor([decodeMotionChannel(value[1]! / 255, 'srgb'), decodeMotionChannel(value[2]! / 255, 'srgb'), decodeMotionChannel(value[3]! / 255, 'srgb'), value[0]! / 255 * scalar(entries, `${prefix} Opacity`, 100) / 100 * alpha]);
	}
	function visit(group: AepChunk, matrix: Matrix, opacity: number): void {
		const entries = aepNamedNodes(group).filter(entry => {
			const state = aepChild(entry.chunk, 'tdsb'); return !state || Boolean(aepView(state.data, 4).getUint32(0) & 1);
		});
		let fill: MotionShape['fill'] = null, stroke: MotionShape['stroke'] = null;
		for (const entry of entries) {
			const values = aepNamedNodes(entry.chunk);
			if (entry.name === 'ADBE Vector Graphic - Fill') {
				if (fill) note(entry.name, 'Multiple fills are retained in the source; the last fill paints this draft.');
				fill = color(values, 'ADBE Vector Fill', [255, 255, 0, 0], opacity);
				if (scalar(values, 'ADBE Vector Fill Rule', 1) !== 1) note(entry.name, 'The source even-odd fill rule needs separate mapping.');
			} else if (entry.name === 'ADBE Vector Graphic - Stroke') {
				if (stroke) note(entry.name, 'Multiple strokes are retained in the source; the last stroke paints this draft.');
				stroke = { color: color(values, 'ADBE Vector Stroke', [255, 255, 255, 255], opacity), width: motionScalar(scalar(values, 'ADBE Vector Stroke Width', 2)),
					lineCap: ({ 1: 'butt', 2: 'round', 3: 'square' } as const)[scalar(values, 'ADBE Vector Stroke Line Cap', 1) as 1] ?? 'butt',
					lineJoin: ({ 1: 'miter', 2: 'round', 3: 'bevel' } as const)[scalar(values, 'ADBE Vector Stroke Line Join', 1) as 1] ?? 'miter' };
			}
		}
		for (const entry of entries) {
			const values = aepNamedNodes(entry.chunk); let path: MotionPathProperty | null = null;
			if (entry.name === 'ADBE Vector Group') {
				const contents = aepNamed(values, 'ADBE Vectors Group'), tr = aepNamedNodes(aepNamed(values, 'ADBE Vector Transform Group'));
				const position = read(tr, 'ADBE Vector Position', [0, 0]), anchor = read(tr, 'ADBE Vector Anchor', [0, 0]), scale = read(tr, 'ADBE Vector Scale', [100, 100]);
				const angle = scalar(tr, 'ADBE Vector Rotation', 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
				const a = cos * scale[0]! / 100, b = sin * scale[0]! / 100, c = -sin * scale[1]! / 100, d = cos * scale[1]! / 100;
				const next = product(matrix, [a, b, c, d, position[0]! - a * anchor[0]! - c * anchor[1]!, position[1]! - b * anchor[0]! - d * anchor[1]!]);
				if (scalar(tr, 'ADBE Vector Skew', 0)) note(entry.name, 'Group skew remains in the source AEP.');
				if (contents) visit(contents, next, opacity * scalar(tr, 'ADBE Vector Group Opacity', 100) / 100);
				continue;
			}
			if (entry.name === 'ADBE Vector Shape - Rect') {
				const size = read(values, 'ADBE Vector Rect Size', [100, 100]), pos = read(values, 'ADBE Vector Rect Position', [0, 0]);
				path = motionRectanglePath({ x: pos[0]! - size[0]! / 2, y: pos[1]! - size[1]! / 2, width: size[0]!, height: size[1]!, radius: scalar(values, 'ADBE Vector Rect Roundness', 0) });
			} else if (entry.name === 'ADBE Vector Shape - Ellipse') {
				const size = read(values, 'ADBE Vector Ellipse Size', [100, 100]), pos = read(values, 'ADBE Vector Ellipse Position', [0, 0]);
				path = motionEllipsePath({ center: [pos[0]!, pos[1]!], radius: [size[0]! / 2, size[1]! / 2] });
			} else if (entry.name === 'ADBE Vector Shape - Star') {
				const pos = read(values, 'ADBE Vector Star Position', [0, 0]);
				path = motionPolygonPath({ center: [pos[0]!, pos[1]!], radius: scalar(values, 'ADBE Vector Star Outer Radius', 100), points: scalar(values, 'ADBE Vector Star Points', 5), rotationDegrees: scalar(values, 'ADBE Vector Star Rotation', 0) - 90,
					...(scalar(values, 'ADBE Vector Star Type', 1) === 2 ? {} : { innerRadius: scalar(values, 'ADBE Vector Star Inner Radius', 50) }) });
				if (scalar(values, 'ADBE Vector Star Outer Roundess', 0) || scalar(values, 'ADBE Vector Star Inner Roundess', 0)) note(entry.name, 'Polystar roundness remains in the source AEP.');
			} else if (entry.name === 'ADBE Vector Shape - Group') {
				const property = aepNamed(values, 'ADBE Vector Shape'); if (property) try { path = readAepShapePath(property); } catch (error) { note(entry.name, String(error)); }
			} else if (!['ADBE Vector Graphic - Fill', 'ADBE Vector Graphic - Stroke', 'ADBE Vector Materials Group'].includes(entry.name)) note(entry.name, 'This vector operator remains in the original AEP and is not applied to these editable paths.');
			if (path) {
				if (shapes.length >= 1024) throw new RangeError('AEP layer exceeds the editable shape budget.');
				if (stroke && (Math.abs(matrix[0] - 1) > 1e-9 || Math.abs(matrix[3] - 1) > 1e-9 || matrix[1] || matrix[2])) note(entry.name, 'Group geometry is flattened; stroke scaling requires render review.');
				shapes.push({ id: context.allocateId(), path: transform(path, matrix), fill, stroke });
			}
		}
	}
	visit(root, identity, 1);
	if (!shapes.length) { note('ADBE Root Vectors Group', 'No supported visible shape paths were found.'); return { kind: 'null' }; }
	context.note(scope, 'ADBE Root Vectors Group', 'editable-shapes', 'Static native vector geometry is imported as editable paths. Group compositing requires render review.', 'editable');
	return { kind: 'shapes', shapes };
}
