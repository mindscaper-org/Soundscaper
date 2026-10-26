/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import VampAnalyzerDialog from '../src/common/editor/ui/dialogs/VampAnalyzerDialog.tsx';
import type { VampAnalysisRequest } from '../src/common/editor/vamp-analysis.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the Vamp footer refuses an empty numeric parameter instead of analyzing with zero', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const requests: VampAnalysisRequest[] = [];
	try {
		await act(async () => root.render(<VampAnalyzerDialog catalog={[{
			analyzerId: 'onsets', stableId: 'example:onsets', binarySha256: 'ab'.repeat(32),
			name: 'Onsets', maker: 'Example', programs: [], parameters: [{ id: 'threshold',
				name: 'Threshold', description: '', unit: '', minValue: 0, maxValue: 1,
				defaultValue: 0.5, quantizeStep: null }],
			outputs: [{ id: 'onsets', name: 'Onsets', description: '', unit: '',
				sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false }],
		}]} projectId="voice-project" scope="track" startFrame={0} endFrame={48_000} sampleRate={48_000}
			analyze={async request => { requests.push(request); return { schemaVersion: 1, request, features: [] }; }}
			publishLabels={() => undefined} onClose={() => undefined} />));
		const input = dom.container.querySelectorAll('input').find(input => String(reactProps(input).type) === 'number');
		const analyze = dom.container.querySelectorAll('button').find(button => button.textContent === 'Analyze');
		assert.ok(input && analyze);
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '' } }));
		await act(async () => reactProps(analyze).onClick({}));
		assert.equal(requests.length, 0, 'the footer is outside the form, so native required validation does not run');
		assert.match(dom.one('[role="alert"]').textContent, /Threshold/u);
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '0' } }));
		await act(async () => reactProps(analyze).onClick({}));
		assert.equal(requests.length, 1);
		assert.deepEqual(requests[0]?.parameters, [{ id: 'threshold', value: 0 }]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
