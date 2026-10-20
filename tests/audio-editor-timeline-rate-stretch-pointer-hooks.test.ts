/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	TimelineRateStretchPreviewGuide,
} from '../src/common/editor/ui/timeline/TimelineOverlayComponents.jsx';


test('timeline renders one conformed rate-stretch guide with the shared transient style', () => {
	const markup = renderGuide(24_000);
	assert.match(markup, /class="audio-editor-trim-preview-guide"/u);
	assert.match(markup, /data-rate-stretch-guide="true"/u);
	assert.match(markup, /data-rate-stretch-edge="right"/u);
	assert.match(markup, /data-rate-stretch-boundary-sample="24000"/u);
	assert.match(markup, /style="left:calc\(312px \+ var\(--timeline-render-origin-x, 0px\)\);height:144px"/u);
	assert.equal(renderGuide(1.5), '');
	assert.equal(renderGuide(Number.MAX_SAFE_INTEGER + 1), '');


});

function renderGuide(sample: number): string {
	const runtime = globalThis as typeof globalThis & { React?: typeof React };
	const previous = runtime.React;
	runtime.React = React;
	try {
		return renderToStaticMarkup(React.createElement(TimelineRateStretchPreviewGuide, {
			sample,
			edge: 'right',
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
