/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('Plot spectrum chooses live playback only without a range and releases it on close', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let acquired = 0, released = 0, offline = 0;
	const controller = { engine: { acquirePlaybackSpectrum: () => {
		acquired++;
		return { fftSize: 4096, read: () => null, release: () => { released++; } };
	}, getPositionFrames: () => 0 }, actions: { analysis: { plotSpectrum: async () => {
		offline++;
		return { type: 'spectrum', bins: [], peak: null, size: 2048, sampleRate: 48_000 };
	} } } };
	const project = { id: 'live-spectrum', sampleRate: 48_000,
		tracks: [{ id: 'audio', type: 'audio', clipIds: ['clip'] }],
		clips: [{ id: 'clip', trackId: 'audio', timelineStartFrame: 10, durationFrames: 48_000 }],
		selection: { startFrame: 0, endFrame: 0, trackIds: [] as string[], clipIds: [] as string[] },
	};
	const snapshot = { project, ready: true, selectedClipId: null as string | null };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (requestId: number) => <AnalysisDialog mode="spectrum" requestId={requestId} controller={controller}
		snapshot={snapshot} copy={ENGLISH_COPY} fileService={{ saveFile: () => undefined }} onClose={() => {}} />;
	try {
		await act(async () => root.render(render(1)));
		assert.equal(dom.one('[data-analysis-mode]').getAttribute('aria-modal'), null);
		assert.equal(acquired, 1);
		assert.equal(offline, 0, 'live mode must not render an offline mix');
		project.selection = { startFrame: 10, endFrame: 48_010, trackIds: ['audio'], clipIds: [] };
		await act(async () => root.render(render(1)));
		assert.equal(dom.one('[data-analysis-mode]').getAttribute('aria-modal'), null, 'the open window retains its mode');
		await act(async () => root.render(render(2)));
		assert.equal(dom.one('[data-analysis-mode]').getAttribute('aria-modal'), 'true');
		assert.equal(released, 1);
		assert.equal(offline, 1);
		project.selection = { startFrame: 0, endFrame: 0, trackIds: [], clipIds: ['clip'] };
		snapshot.selectedClipId = 'clip';
		await act(async () => root.render(render(3)));
		assert.equal(dom.one('[data-analysis-mode]').getAttribute('aria-modal'), 'true', 'selected clips still name an audio range');
		assert.equal(offline, 2);
		assert.equal(acquired, 1);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
