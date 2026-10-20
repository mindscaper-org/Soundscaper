/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	timelineTrimPreviewGuideLeft,
	TimelineTrimPreviewGuide,
} from '../src/common/editor/ui/timeline/TimelineOverlayComponents.jsx';


test('the transient trim guide uses the conformed sample in timeline coordinates', () => {
	assert.equal(timelineTrimPreviewGuideLeft(24_000, 240, 120, 48_000), 312);
	const markup = renderGuide(24_000);
	assert.match(markup, /class="audio-editor-trim-preview-guide"/u);
	assert.match(markup, /data-roll-ripple-trim-guide="true"/u);
	assert.match(markup, /aria-hidden="true"/u);
	assert.match(markup, /style="left:calc\(312px \+ var\(--timeline-render-origin-x, 0px\)\);height:144px"/u);
	for (const sample of [null, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
		assert.equal(renderGuide(sample), '', String(sample));
	}
});

function renderGuide(sample: number | null): string {
	const runtime = globalThis as typeof globalThis & { React?: typeof React };
	const previous = runtime.React;
	runtime.React = React;
	try {
		return renderToStaticMarkup(React.createElement(TimelineTrimPreviewGuide, {
			sample, panelWidth: 240, pixelsPerSecond: 120, sampleRate: 48_000, height: 144,
		}));
	} finally {
		if (previous === undefined) Reflect.deleteProperty(runtime, 'React');
		else runtime.React = previous;
	}
}
