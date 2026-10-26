/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const switchProject of [false, true]) test(`a Contrast report save failure stays ${switchProject ? 'out of the next' : 'visible in its own'} project`, async () => {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let rejectSave: ((error: Error) => void) | undefined;
	const fileService = { saveFile: () => new Promise<void>((_resolve, reject) => { rejectSave = reject; }) };
	const controller = { actions: { analysis: { contrast: () => undefined } } };
	const render = (id: string) => root.render(<AnalysisDialog mode="contrast" controller={controller} copy={ENGLISH_COPY}
		fileService={fileService} onClose={() => undefined} snapshot={{ ready: true, project: {
			id, title: id, sampleRate: 48_000, clips: [], tracks: [], selection: null,
		}, analysisReport: id === 'first' ? { type: 'contrast', foreground: { rmsDb: -12 } } : null }} />);
	try {
		await act(async () => { render('first'); });
		const button = dom.container.querySelectorAll('button').find(element => element.textContent === ENGLISH_COPY.export);
		assert.ok(button);
		await act(async () => { reactProps(button).onClick(); });
		assert.ok(rejectSave);
		if (switchProject) await act(async () => { render('second'); });
		await act(async () => { rejectSave?.(new Error('Old report destination is unavailable.')); });
		if (switchProject) assert.equal(dom.find('[role="alert"]'), null, 'the new project does not own this report-save failure');
		else assert.equal(dom.one('[role="alert"]').textContent, 'Old report destination is unavailable.');
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
