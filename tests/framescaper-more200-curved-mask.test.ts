/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateVideoMaskMatteRgbaV13 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import type { VideoMaskMatteGraphV1, VideoMaskPathV1, VideoMaskPointV1 } from '../src/common/editor/video-mask-matte-v24.ts';

const point = (x: number, y: number): VideoMaskPointV1 => ({ position: { x, y }, inHandle: null, outHandle: null });
const outline: VideoMaskPathV1 = { id: 'outline', closed: true, points: [
	{ ...point(0.25, 0.5), outHandle: { x: 0.25, y: 0 } },
	{ ...point(0.75, 0.5), inHandle: { x: 0.75, y: 0 } }, point(0.5, 0.75),
] };
function render(paths: readonly VideoMaskPathV1[], fillRule: 'nonzero' | 'even-odd' = 'nonzero') {
	const graph: VideoMaskMatteGraphV1 = { schemaVersion: 1, id: 'curve-mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'curve', kind: 'vector-path', fillRule, paths }], outputNodeId: 'curve' };
	return evaluateVideoMaskMatteRgbaV13(graph, 320, 180);
}
const at = (plane: Uint8Array, x: number, y: number): number | undefined => plane[y * 320 + x];

for (const reverse of [false, true]) test(`a ${reverse ? 'reverse' : 'forward'} cubic contour preserves its curved coverage`, () => {
	const path = reverse ? { ...outline, points: [...outline.points].reverse().map(value => ({
		...value, inHandle: value.outHandle, outHandle: value.inHandle,
	})) } : outline;
	const pixels = render([path]);
	assert.equal(at(pixels, 160, 54), 255, 'the cubic arch contains the upper point despite its straight control polygon');
	assert.equal(at(pixels, 160, 99), 255, 'retain the polygon interior');
	assert.equal(at(pixels, 160, 10), 0, 'retain the curve exterior');
});

test('both cubic crossings survive a nonmonotone edge and fill-rule holes', () => {
	const doubled = { ...outline, id: 'second' };
	assert.equal(at(render([outline, doubled], 'nonzero'), 160, 54), 255);
	assert.equal(at(render([outline, doubled], 'even-odd'), 160, 54), 0);
	const reversed = { ...outline, id: 'opposite', points: [...outline.points].reverse().map(value => ({
		...value, inHandle: value.outHandle, outHandle: value.inHandle,
	})) };
	assert.equal(at(render([outline, reversed]), 160, 54), 0);
});

test('a single authored handle uses the missing handle endpoint, without dropping the curve', () => {
	for (const missing of ['inHandle', 'outHandle'] as const) {
		const points = outline.points.map(value => ({ ...value, [missing]: null }));
		assert.equal(at(render([{ ...outline, points }]), 160, 75), 255);
	}
});

test('a closing cubic segment retains the same coverage when the contour origin rotates', () => {
	const rotated = { ...outline, points: [...outline.points.slice(1), outline.points[0]!] };
	assert.deepEqual(render([rotated]), render([outline]));
});

test('a two-point open cubic encloses a curved region with its straight fill closure', () => {
	assert.equal(at(render([{ ...outline, closed: false, points: outline.points.slice(0, 2) }]), 160, 54), 255);
});

test('an open contour closes with a straight fill edge, ignoring unconnected endpoint handles', () => {
	const path: VideoMaskPathV1 = { id: 'open', closed: false, points: [
		{ ...point(0.25, 0.5), inHandle: { x: 0.25, y: 0 } }, point(0.5, 0.75),
		{ ...point(0.75, 0.5), outHandle: { x: 0.75, y: 0 } },
	] };
	assert.equal(at(render([path]), 160, 54), 0);
	assert.equal(at(render([path]), 160, 99), 255);
});

test('absent handles keep straight polygon coverage pixel-exact', () => {
	const polygon = { ...outline, points: outline.points.map(value => ({ ...value, inHandle: null, outHandle: null })) };
	const pixels = render([polygon]);
	for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
		const px = (x + 0.5) / 320, py = (y + 0.5) / 180;
		let winding = 0;
		for (let index = 0; index < polygon.points.length; index++) {
			const a = polygon.points[index]!.position, b = polygon.points[(index + 1) % polygon.points.length]!.position;
			const cross = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
			if (a.y <= py && b.y > py && cross > 0) winding++;
			else if (a.y > py && b.y <= py && cross < 0) winding--;
		}
		assert.equal(at(pixels, x, y), winding === 0 ? 0 : 255);
	}
});
