/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import AudacityDynamicsEffectLayout from '../src/common/editor/ui/AudacityDynamicsEffectLayout.jsx';

const compressorNames = ['attackMs', 'releaseMs', 'lookaheadMs', 'thresholdDb', 'ratio', 'kneeWidthDb', 'makeupGainDb'];
const limiterNames = ['thresholdDb', 'makeupTargetDb', 'lookaheadMs', 'kneeWidthDb', 'releaseMs', 'limitTruePeaks'];

function render(effectType: string, live: boolean): string {
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const names = effectType === 'audacity-compressor' ? compressorNames : limiterNames;
	try { return renderToStaticMarkup(<AudacityDynamicsEffectLayout
		effectType={effectType}
		definition={{ params: Object.fromEntries(names.map(name => [name, {}])) }}
		renderParameter={(name: string) => <span>{name}</span>}
		copy={{}}
		readDynamicsAnalysis={live ? () => null : null}
	/>); } finally {
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
	}
}

test('Audacity compressor places its live history above controls and a labelled soft-knee curve', () => {
	const markup = render('audacity-compressor', true);
	assert.ok(markup.indexOf('data-dynamics-activity') < markup.indexOf('data-audacity-parameter="attackMs"'));
	assert.match(markup, /aria-label="Compression curve"/u);
	assert.match(markup, /aria-label="Input, output and compression history"/u);
	for (const label of ['Input', 'Output', 'Compression']) assert.match(markup, new RegExp(`aria-label="${label}"`, 'u'));
	for (const name of compressorNames) assert.equal(markup.split(`data-audacity-parameter="${name}"`).length, 2);
});

test('Audacity limiter has its own five-knob strip and 3 dB history scale without a transfer plot', () => {
	const markup = render('audacity-limiter', true);
	assert.doesNotMatch(markup, /aria-label="Compression curve"/u);
	assert.match(markup, /data-dynamics-floor="-12"/u);
	for (const name of limiterNames) assert.equal(markup.split(`data-audacity-parameter="${name}"`).length, 2);
});

test('destructive Audacity dynamics dialogs omit live metering', () => {
	for (const type of ['audacity-compressor', 'audacity-limiter']) assert.doesNotMatch(render(type, false), /data-dynamics-activity/u);
});

test('the limiter places true peak limiting below its secondary knobs inside the controls block', () => {
	const document = new JSDOM(render('audacity-limiter', true)).window.document;
	const checkbox = document.querySelector('[data-audacity-parameter="limitTruePeaks"]');
	assert.ok(checkbox);
	assert.ok(checkbox.closest('.audio-editor-audacity-dynamics__controls'));
	assert.equal(checkbox.parentElement?.lastElementChild, checkbox);
	assert.equal(checkbox.previousElementSibling?.getAttribute('data-audacity-parameter'), 'releaseMs');
});
