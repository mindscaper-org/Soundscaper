/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import React, { act } from 'react';

import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { deferred } from './helpers/async-test-control.ts';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('the retired offline analysis panel is absent', () => {
	assert.equal(existsSync(new URL('../src/common/editor/ui/inspector/AnalysisPanel.jsx', import.meta.url)), false);
});

for (const replaceProject of [false, true]) test(`Contrast ${replaceProject ? 'discards a late failure after project replacement' : 'shows a failure for the current project'}`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const contrast = deferred<void>();
	const controller = {
		actions: { analysis: {
			contrast: () => contrast.promise,
		} },
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderDialog = (projectId: string) => <AnalysisDialog
		mode="contrast"
		controller={controller}
		snapshot={snapshot(projectId)}
		copy={ENGLISH_COPY}
		fileService={{ saveFile: () => undefined }}
		onClose={() => undefined}
	/>;
	try {
		await act(async () => root.render(renderDialog('project-a')));
		const foreground = () => buttonWithText(dom.container, ENGLISH_COPY.captureContrastForeground);
		await act(async () => {
			reactProps(foreground()).onClick({});
		});
		assert.equal(foreground().hasAttribute('disabled'), true, 'the capture has started');

		if (replaceProject) await act(async () => root.render(renderDialog('project-b')));
		await act(async () => {
			contrast.reject(new Error('Project A analysis failed.'));
			await contrast.promise.catch(() => undefined);
		});

		assert.equal(
			dom.container.textContent.includes('Project A analysis failed.'),
			!replaceProject,
		);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function snapshot(projectId: string) {
	return {
		ready: true,
		project: {
			id: projectId,
			title: projectId,
			revision: 1,
			sampleRate: 48_000,
			clips: [{ id: 'shared-clip', timelineStartFrame: 0, durationFrames: 1_000 }],
			tracks: [{ id: 'shared-track', type: 'audio', clipIds: ['shared-clip'] }],
			selection: { startFrame: 0, endFrame: 1_000, trackIds: ['shared-track'], clipIds: [] },
		},
		importing: false,
		recording: false,
		exporting: false,
		analysisProcessing: false,
		missingSourceIds: [],
	};
}

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Missing button ${text}.`);
	return button;
}
