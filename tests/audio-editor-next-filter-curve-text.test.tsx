/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FilterCurveEqEditor from '../src/common/editor/ui/inspector/FilterCurveEqEditor.tsx';
import type { FilterCurvePoint } from '../src/common/editor/audacity-effects/filter-curve.ts';
import { installResponsivenessTestDom } from './helpers/responsiveness-round4-ui-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

for (const draft of ['100:', '100:6:9']) {
	test(`an incomplete or extra EQ coordinate ${draft} leaves the authored curve intact`, async () => {
		const original = [{ frequency: 100, gain: 6 }];
		let authored: readonly FilterCurvePoint[] = original;
		const dom = installResponsivenessTestDom();
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => { root.render(<FilterCurveEqEditor name="points" label="Curve points" value={original}
				sampleRate={48_000} linearFrequencyScale={false} filterLength={8} disabled={false}
				copy={{ reset: 'Reset', invert: 'Invert' }} onCommit={points => { authored = points; }} />); });
			const field = dom.one('textarea');
			await act(async () => { reactProps(field).onChange({ target: { value: draft } }); });
			await act(async () => { reactProps(field).onBlur(); });
			assert.equal(field.getAttribute('aria-invalid'), 'true', 'malformed coordinates must be refused');
			assert.equal(authored, original);
			await act(async () => { reactProps(field).onChange({ target: { value: '100 : 3; 1000 -6' } }); });
			await act(async () => { reactProps(field).onBlur(); });
			assert.equal(field.getAttribute('aria-invalid'), null);
			assert.deepEqual(authored, [{ frequency: 100, gain: 3 }, { frequency: 1000, gain: -6 }]);
		} finally {
			await act(async () => { root.unmount(); });
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
