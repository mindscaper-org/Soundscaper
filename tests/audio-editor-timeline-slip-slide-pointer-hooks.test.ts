/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	TimelineSlipSlidePreviewGuides,
} from '../src/common/editor/ui/timeline/TimelineOverlayComponents.jsx';


test('slide renders two transient conformed guides without changing the roll/ripple guide', () => {
	const markup = renderGuides({ start: 24_000, end: 72_000 });
	assert.equal((markup.match(/data-slip-slide-trim-guide="true"/gu) ?? []).length, 2);
	assert.match(markup, /data-slip-slide-guide-role="start"/u);
	assert.match(markup, /data-slip-slide-guide-role="end"/u);
	assert.match(markup, /style="left:calc\(312px \+ var\(--timeline-render-origin-x, 0px\)\);height:144px"/u);
	assert.match(markup, /style="left:calc\(432px \+ var\(--timeline-render-origin-x, 0px\)\);height:144px"/u);
	assert.doesNotMatch(markup, /data-roll-ripple-trim-guide/u);
	for (const samples of [
		null,
		{ start: 1.5, end: 72_000 },
		{ start: 24_000, end: Number.MAX_SAFE_INTEGER + 1 },
	]) {
		assert.equal(renderGuides(samples), '');
	}
});

function renderGuides(samples: Readonly<{ readonly start: number; readonly end: number }> | null): string {
	const runtime = globalThis as typeof globalThis & { React?: typeof React };
	const previous = runtime.React;
	runtime.React = React;
	try {
		return renderToStaticMarkup(React.createElement(TimelineSlipSlidePreviewGuides, {
			samples,
			panelWidth: 240,
			pixelsPerSecond: 120,
			sampleRate: 48_000,
			height: 144,
		}));
	} finally {
		if (previous === undefined) Reflect.deleteProperty(runtime, 'React');
		else runtime.React = previous;
	}
}
