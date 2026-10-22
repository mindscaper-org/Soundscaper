/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { admitVampAnalyzerConfiguration, admitVampAnalyzerDescriptor } from '../desktop/vamp-analyzer-contract.ts';
import VampAnalyzerDialog from '../src/common/editor/ui/dialogs/VampAnalyzerDialog.tsx';
import type { VampAnalysisRequest } from '../src/common/editor/vamp-analysis.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const parameter = { id: 'threshold', name: 'Threshold', description: '', unit: '', minValue: 0,
	maxValue: 1, defaultValue: 0.5, quantizeStep: null };
const analyzer = { analyzerId: 'installed-onsets', stableId: 'example:onsets', binarySha256: 'ab'.repeat(32),
	name: 'Onsets', maker: 'Example', programs: ['Sensitive'], parameters: [parameter],
	outputs: [{ id: 'onsets', name: 'Onsets', description: '', unit: '',
		sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false }] };

test('a menu-selected Vamp program retains its parameter values until the user overrides them', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const requests: VampAnalysisRequest[] = [];
	try {
		await act(async () => root.render(<VampAnalyzerDialog catalog={[analyzer]} projectId="voice-project"
			scope="track" startFrame={0} endFrame={48_000} sampleRate={48_000}
			analyze={async request => {
				requests.push(request);
				return { schemaVersion: 1, request, features: [] };
			}} publishLabels={() => undefined} onClose={() => undefined} />));
		const program = dom.container.querySelectorAll('select').find(select => String(reactProps(select).value) === '');
		assert.ok(program);
		await act(async () => reactProps(program).onChange({ currentTarget: { value: 'Sensitive' } }));
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		assert.deepEqual(requests[0]?.parameters, [], 'untouched defaults must not overwrite the chosen program');
		const input = dom.container.querySelectorAll('input').find(input => String(reactProps(input).type) === 'number');
		assert.ok(input);
		assert.equal(reactProps(input).value, '', 'an inherited program value must not pretend to be the factory default');
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '0.25' } }));
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		assert.deepEqual(requests[1]?.parameters, [{ id: 'threshold', value: 0.25 }]);
		await act(async () => reactProps(program).onChange({ currentTarget: { value: '' } }));
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		assert.deepEqual(requests[2]?.parameters, [{ id: 'threshold', value: 0.5 }]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

test('desktop Vamp configuration leaves omitted program parameters to the native preset', () => {
	const descriptor = admitVampAnalyzerDescriptor({ kind: 'analyzer', format: 'vamp', identifier: 'onsets', name: 'Onsets', description: '',
		maker: 'Example', copyright: '', pluginVersion: 1, vampApiVersion: 2, inputDomain: 'time', minimumChannels: 1,
		maximumChannels: 2, preferredStepSize: 512, preferredBlockSize: 1024,
		programs: ['Sensitive'], parameters: [{ identifier: 'threshold', name: 'Threshold', description: '',
			unit: '', minimumValue: 0, maximumValue: 1, defaultValue: 0.5, quantizeStep: null, valueNames: [] }],
		outputs: [{ identifier: 'onsets', name: 'Onsets', description: '', unit: '', binCount: null,
			binNames: [], extents: null, quantizeStep: null, sampleType: 'variable-sample-rate',
			sampleRate: null, hasDuration: false }] });
	const base = { sampleRate: 48_000, channelCount: 1, stepSize: 512, blockSize: 1024,
		frameCount: 48_000, parameters: {}, program: 'Sensitive' };
	assert.deepEqual(admitVampAnalyzerConfiguration(base, descriptor).parameters, {});
	assert.deepEqual(admitVampAnalyzerConfiguration({ ...base, program: null }, descriptor).parameters,
		{ threshold: 0.5 });
	assert.deepEqual(admitVampAnalyzerConfiguration({ ...base, parameters: { threshold: 0.25 } }, descriptor).parameters,
		{ threshold: 0.25 });
});
