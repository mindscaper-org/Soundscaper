/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionAnalysisControls } from '../src/common/editor/ui/dialogs/FramescaperFinishingPanels.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('motion ranges display sample format in the project PCM clock independently of source video fps', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const observer = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const source = { id: 'camera', kind: 'video', frameRate: { num: 15, den: 1 }, sourceFrameCount: 32,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 15, den: 1 } } };
	const target = { stackId: 'tracking', sourceId: source.id, sourceName: 'camera.webm',
		startFrame: 0, endFrame: 32, analysisId: 'analysis', freshness: 'missing' as const };
	const props = { source, sampleRate: 44_100, blocked: false, targets: [target], target, stackId: target.stackId,
		startFrame: 0, endFrame: 15, progress: null, pending: false, copy: {},
		onStack() {}, onStartFrame() {}, onEndFrame() {}, onAnalyze() {}, onCancel() {} };
	try {
		await act(async () => { root.render(<MotionAnalysisControls {...props} />); });
		const trigger = dom.container.querySelectorAll('.timecode__format-button')[1]; assert.ok(trigger);
		await act(async () => { reactProps(trigger).onClick?.({ detail: 1 }); });
		const samples = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'samples'); assert.ok(samples);
		await act(async () => { reactProps(samples).onClick?.({}); });
		const end = dom.container.querySelectorAll('.timecode__display')[1]; assert.ok(end);
		assert.equal(end.querySelectorAll('.timecode-digit').map(digit => digit.textContent).join(''), '000000044100');
	} finally {
		await act(async () => { root.unmount(); });
		if (observer) Object.defineProperty(globalThis, 'MutationObserver', observer); else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});
