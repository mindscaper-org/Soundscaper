/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrackFadeHandle } from '../vendor/audacity-design-system/components/src/Track/TrackFadeHandle.tsx';
import { trackFadeHandleGeometry } from '../vendor/audacity-design-system/components/src/Track/track-fade-handle-geometry.ts';

test('upstream fade hit targets start at the boundary and leave the clip edge to trimming', () => {
	assert.deepEqual(trackFadeHandleGeometry('in', 0, 400, 400), { left: 6, width: 24, glyphLeft: -9 });
	assert.deepEqual(trackFadeHandleGeometry('out', 400, 0, 400), { left: 370, width: 24, glyphLeft: -3 });
	assert.deepEqual(trackFadeHandleGeometry('in', 100, 300, 400), { left: 100, width: 30, glyphLeft: -3 });
	assert.deepEqual(trackFadeHandleGeometry('out', 300, 100, 400), { left: 270, width: 30, glyphLeft: -3 });
	const incoming = trackFadeHandleGeometry('in', 190, 210, 400);
	const outgoing = trackFadeHandleGeometry('out', 210, 190, 400);
	assert.equal(incoming.left + incoming.width, 190);
	assert.equal(outgoing.left, 210);
});

test('fade glyph uses the upstream rounded black body, white halo and white curve', () => {
	const markup = renderToStaticMarkup(<TrackFadeHandle edge="in" boundaryX={100} oppositeBoundaryX={300}
		clipWidth={400} aria-label="Fade in" aria-valuemin={0} aria-valuemax={4} aria-valuenow={1} />);
	assert.match(markup, /data-fade-glyph-frame[^>]*fill="#000000"/u);
	assert.match(markup, /data-fade-glyph-halo/u);
	assert.match(markup, /data-fade-glyph-curve/u);
	assert.match(markup, /viewBox="0 0 36 32"/u);
	assert.match(markup, /width:30px/u);
});
