/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import AcxCompliancePanel from '../src/common/editor/ui/inspector/AcxCompliancePanel.tsx';
import { ACX_COMPLIANCE_COPY } from '../src/common/i18n/editor-acx-compliance-copy.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const measurement = { sampleRate: 44_100, channelCount: 1, frameCount: 44_100,
	peakDbfs: -4, rmsDbfs: -20, noiseFloorDbfs: -65 };

test('ACX panel checks on request, exports its measurement and clears results after an edit', async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT, previousReact = globals.React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.React = React;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct; globals.React = previousReact; dom.restore();
	});
	let calls = 0;
	let request = deferred<unknown>();
	const saved: { text: string; suggestedName: string }[] = [];
	const controller = { actions: { analysis: { run: (scope: string) => {
		assert.equal(scope, 'master'); calls += 1; return request.promise;
	} } } };
	const render = (revision: number, importing = false) => root.render(<AcxCompliancePanel controller={controller}
		snapshot={{ ready: true, project: { id: 'acx-project', revision, title: 'Chapter 1', clips: [{}] }, importing }}
		copy={ACX_COMPLIANCE_COPY} commonCopy={ENGLISH_COPY} fileService={{ saveFile: value => { saved.push(value); } }} />);
	const click = async (label: string) => {
		const button = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === label);
		assert.ok(button, `Missing ${label} button`);
		await act(async () => { reactProps(button).onClick(); });
	};
	await act(async () => render(1));
	assert.equal(calls, 0, 'mounting the expanded content does not start an analysis');
	await click(ACX_COMPLIANCE_COPY.checkAudio);
	assert.equal(calls, 1);
	await act(async () => { request.resolve(measurement); await request.promise; });
	assert.ok(dom.container.textContent.includes(ACX_COMPLIANCE_COPY.passSummary));
	await click(ENGLISH_COPY.export);
	assert.equal(saved.length, 1);
	assert.equal(saved[0].suggestedName, 'Chapter-1-acx-compliance.json');
	const exported = JSON.parse(saved[0].text) as { measurement: unknown; report: { status: string }; scope: string };
	assert.deepEqual(exported.measurement, measurement);
	assert.equal(exported.report.status, 'pass');
	assert.equal(exported.scope, 'master');
	await act(async () => render(2));
	assert.ok(dom.container.textContent.includes(ACX_COMPLIANCE_COPY.empty), 'edits retire old results');
	request = deferred<unknown>();
	await click(ACX_COMPLIANCE_COPY.checkAudio);
	await act(async () => render(3));
	await act(async () => { request.resolve(measurement); await request.promise; });
	assert.ok(dom.container.textContent.includes(ACX_COMPLIANCE_COPY.empty), 'a retired request cannot republish');
	request = deferred<unknown>();
	await click(ACX_COMPLIANCE_COPY.checkAudio);
	await act(async () => { request.reject(new Error('Audio check failed')); await request.promise.catch(() => undefined); });
	assert.equal(dom.one('[role="alert"]').textContent, 'Audio check failed');
	await act(async () => render(4, true));
	const checkButton = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === ACX_COMPLIANCE_COPY.checkAudio);
	assert.ok(checkButton);
	assert.equal(checkButton.getAttribute('disabled'), '', 'importing blocks an ACX request');
});
