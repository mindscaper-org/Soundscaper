/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ParametricEqEditor } from '../src/common/editor/ui/ParametricEqEditor.jsx';

test('a translated EQ band announces authored frequency, its effective limit and the source rate', () => {
	const markup = renderToStaticMarkup(<ParametricEqEditor sampleRate={8_000}
		onGestureBegin={undefined} onPreview={undefined} onCommit={undefined} onCancel={undefined}
		onAudition={undefined} readSpectrum={undefined} parameterAutomation={undefined} params={{ bands: [{
		id: 'limited-band', type: 'peaking', enabled: true, frequency: 24_000, gain: 0, q: 1,
	}] }} copy={{ bandNumber: 'Band {number}',
		'ui.parametricEq.frequencyLimit': 'Angegeben {authoredFrequency} Hz; wirksam {effectiveFrequency} Hz bei {sampleRate} Hz',
	}} />);
	assert.match(markup, /Angegeben 24000 Hz; wirksam 3920 Hz bei 8000 Hz/u);
	assert.doesNotMatch(markup, /effective at/u);
	assert.match(markup, /data-nyquist-limited="true"/u);
});
