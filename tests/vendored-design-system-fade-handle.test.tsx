/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TrackFadeHandle } from '../vendor/audacity-design-system/components/src/Track/TrackFadeHandle.tsx';

function renderHandle(edge: 'in' | 'out', boundaryX: number, oppositeBoundaryX: number, clipWidth = 400): string {
	return renderToStaticMarkup(<TrackFadeHandle edge={edge} boundaryX={boundaryX}
		oppositeBoundaryX={oppositeBoundaryX} clipWidth={clipWidth} aria-label={`Fade ${edge}`}
		aria-valuemin={0} aria-valuemax={4} aria-valuenow={1} tabIndex={-1}
		data-clip-fade-handle={edge} title={`Fade ${edge}`} />);
}

test('fade handles retain the design-system glyph and accessible host props', () => {
	const incoming = renderHandle('in', 100, 300);
	const outgoing = renderHandle('out', 300, 100);
	assert.match(incoming, /<button[^>]*type="button"[^>]*role="slider"/u);
	assert.match(incoming, /class="audacity-track-fade-handle"/u);
	assert.match(incoming, /data-fade-handle="in"/u);
	assert.match(incoming, /data-clip-fade-handle="in"/u);
	assert.match(incoming, /aria-label="Fade in"/u);
	assert.match(incoming, /aria-valuemax="4"/u);
	assert.match(incoming, /tabindex="-1"/u);
	assert.match(incoming, /style="left:100px;width:30px"/u);
	assert.match(incoming, /data-fade-glyph-frame/u);
	assert.match(outgoing, /style="left:270px;width:30px"/u);
	assert.match(outgoing, /transform:scaleX\(-1\)/u);
});

test('fade handles retreat into their own regions when boundaries approach and stay inside the clip', () => {
	assert.match(renderHandle('in', 190, 210), /style="left:160px;width:30px"/u);
	assert.match(renderHandle('out', 210, 190), /style="left:210px;width:30px"/u);
	assert.match(renderHandle('in', 200, 216), /style="left:170px;width:30px"/u);
	assert.match(renderHandle('out', 216, 200), /style="left:216px;width:30px"/u);
	assert.match(renderHandle('in', 0, 400), /style="left:6px;width:24px"/u);
	assert.match(renderHandle('out', 400, 0), /style="left:370px;width:24px"/u);
	assert.equal(renderHandle('in', 0, 40, 40), '');
	assert.notEqual(renderHandle('in', 0, 66, 66), '');
});

test('legacy coincident and crossed fades retain independently reachable targets', () => {
	for (const [incoming, outgoing, width] of [[200, 200, 400], [210, 190, 400], [0, 0, 400], [400, 400, 400], [18, 2, 66], [62, 46, 66]]) {
		const parse = (markup: string) => {
			const match = markup.match(/style="left:([\d.]+)px;width:([\d.]+)px"/u);
			assert.ok(match);
			return { left: Number(match[1]), width: Number(match[2]) };
		};
		const first = parse(renderHandle('in', incoming!, outgoing!, width));
		const second = parse(renderHandle('out', outgoing!, incoming!, width));
		assert.ok(first.left + first.width <= second.left || second.left + second.width <= first.left);
		assert.ok(first.left >= 6 && first.left + first.width <= width! - 6);
		assert.ok(second.left >= 6 && second.left + second.width <= width! - 6);
	}
});
