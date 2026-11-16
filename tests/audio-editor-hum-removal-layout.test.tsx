/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import EffectParameterEditor from '../src/common/editor/ui/inspector/EffectParameterEditor.jsx';
import { createEffect } from '../src/common/editor/effects.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

test('Hum removal omits the redundant section heading and keeps help with the frequency control', () => {
	const markup = renderToStaticMarkup(<EffectParameterEditor
		effect={createEffect('hum-removal')}
		copy={ENGLISH_COPY}
		disabled={false}
		tracks={[]}
		targetTrackId="track-1"
		captureNoiseProfile={undefined}
		noiseProfileLabel=""
		onRackEffectGestureBegin={undefined}
		onRackEffectPreview={undefined}
		onRackEffectCommit={undefined}
		onRackEffectCancel={undefined}
		onParametricEqGestureBegin={undefined}
		onParametricEqPreview={undefined}
		onParametricEqCommit={undefined}
		onParametricEqCancel={undefined}
		onParametricEqAudition={undefined}
		readParametricEqSpectrum={undefined}
		automationRuntime={undefined}
		automationProject={undefined}
		automationStrip={undefined}
		onChange={() => undefined}
	/>);
	const { document } = new JSDOM(markup).window;
	assert.equal(document.querySelectorAll('h3').length, 0);
	assert.equal(document.querySelectorAll('input[type="number"]').length, 4);
	for (const name of ['Fundamental frequency', 'Harmonics', 'Notch width', 'Reduction']) {
		assert.ok(document.querySelector(`[role="group"][aria-label="${name}"] input[type="number"]`), name);
	}
	const frequency = document.querySelector('[role="group"][aria-label="Fundamental frequency"]');
	assert.ok(frequency?.querySelector('button[aria-label="Help: Fundamental frequency"]'));
	assert.equal(document.querySelectorAll('button[aria-label^="Help:"]').length, 1);
});
