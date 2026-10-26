/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Contrast restores the current saved report without recapture and clears it on a project switch', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const project = {
		id: 'first', title: 'Project', sampleRate: 48_000,
		clips: [{ id: 'clip', timelineStartFrame: 0, durationFrames: 48_000 }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		selection: { startFrame: 0, endFrame: 48_000, trackIds: ['track'], clipIds: [] },
	};
	const snapshot = { project, ready: true, analysisProcessing: false, missingSourceIds: [],
		analysisReport: { type: 'contrast', foreground: { rmsDb: -10 }, background: { rmsDb: -35 },
			differenceDb: 25, passes: true } };
	const controller = { actions: { analysis: { contrast: () => { throw new Error('Unexpected recapture.'); } } } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AnalysisDialog mode="contrast" controller={controller}
			snapshot={snapshot} copy={ENGLISH_COPY} fileService={{ saveFile: () => undefined }} onClose={() => undefined} />));
		assert.ok(dom.find('[data-analysis-report="contrast"]'));
		assert.match(dom.one('[data-analysis-report="contrast"]').textContent, /25\.00 dB/u);
		await act(async () => root.render(<AnalysisDialog mode="contrast" controller={controller}
			snapshot={{ ...snapshot, project: { ...project, id: 'second' }, analysisReport: null }}
			copy={ENGLISH_COPY} fileService={{ saveFile: () => undefined }} onClose={() => undefined} />));
		assert.equal(dom.find('[data-analysis-report="contrast"]'), null);
		await act(async () => root.render(<AnalysisDialog mode="contrast" controller={controller}
			snapshot={{ ...snapshot, project: { ...project, id: 'third' }, analysisReport: { type: 'levels' } }}
			copy={ENGLISH_COPY} fileService={{ saveFile: () => undefined }} onClose={() => undefined} />));
		assert.equal(dom.find('[data-analysis-report="contrast"]'), null);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

test('a project switch releases a pending modeless Contrast capture for the next project', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let resolveOld: ((value: unknown) => void) | undefined;
	let captures = 0;
	const controller = { actions: { analysis: { contrast: async () => {
		captures++;
		if (captures === 1) return new Promise(resolve => { resolveOld = resolve; });
		return { type: 'contrast', foreground: { rmsDb: -12 } };
	} } } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (projectId: string) => root.render(<AnalysisDialog mode="contrast" controller={controller}
		snapshot={{ ready: true, analysisProcessing: false, missingSourceIds: [], project: {
			id: projectId, title: projectId, sampleRate: 48_000,
			clips: [{ id: 'clip', timelineStartFrame: 0, durationFrames: 48_000 }],
			tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
			selection: { startFrame: 0, endFrame: 48_000, trackIds: ['track'], clipIds: [] },
		} }} copy={ENGLISH_COPY} fileService={{ saveFile() {} }} onClose={() => undefined} />);
	const foreground = () => {
		const button = dom.container.querySelectorAll('button').find(item => item.textContent === ENGLISH_COPY.captureContrastForeground);
		assert.ok(button); return button;
	};
	try {
		await act(async () => { render('first'); });
		assert.equal(dom.one('[data-analysis-mode]').getAttribute('aria-modal'), null, 'Contrast allows File/Open while working');
		await act(async () => reactProps(foreground()).onClick());
		assert.equal(foreground().hasAttribute('disabled'), true);
		await act(async () => { render('second'); });
		assert.equal(foreground().hasAttribute('disabled'), false, 'the next project must be able to capture its own selection');
		await act(async () => { resolveOld?.({ type: 'contrast', foreground: { rmsDb: -60 } }); });
		assert.equal(dom.find('[data-analysis-report="contrast"]'), null, 'the old report cannot appear in the new project');
		await act(async () => reactProps(foreground()).onClick());
		assert.equal(captures, 2);
		assert.match(dom.one('[data-analysis-report="contrast"]').textContent, /-12\.0 dBFS/u);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
