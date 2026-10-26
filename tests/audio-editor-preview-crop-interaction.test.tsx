/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FreesoundPanel, { type FreesoundPanelState } from '../src/common/editor/ui/workspace/FreesoundPanel.tsx';
import DraggableCropOverlay from '../src/common/editor/ui/dialogs/LocalAssistanceCropOverlay.tsx';
import { FREESOUND_ATTRIBUTION_COPY_BY_LOCALE } from '../src/common/i18n/freesound-attribution-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const state: FreesoundPanelState = { query: 'rain', license: 'all', sort: 'relevance', page: 1, pageCount: 1, totalResults: 1, status: 'ready', previewingSoundId: 1, previewPaused: false, previewPositionSeconds: 0.4, results: [{ soundId: 1, name: 'Rain', username: 'Recorder', soundUrl: 'https://freesound.org/s/1/', licenseName: 'CC0', licenseCode: 'cc0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', durationSeconds: 0.8, durationLabel: '0.8', waveformUrl: '/waveform' }] };

test('the waveform exposes its preview position and keyboard seeking without coordinate-zero resets', async () => {
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const seeks: number[] = [];
	try {
		await act(async () => root.render(<FreesoundPanel copy={FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.en} state={state} disabled={false} onSearch={() => undefined} onPreview={() => undefined} onPausePreview={() => undefined} onResumePreview={() => undefined} onSeekPreview={(_id, seconds) => seeks.push(seconds)} onInsertAtPlayhead={() => undefined} onAddToProjectBin={() => undefined} />));
		const slider = dom.one('[role="slider"]');
		assert.equal(slider.getAttribute('aria-valuenow'), '0.4');
		for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) await act(async () => reactProps(slider).onKeyDown?.({ key, preventDefault() {} }));
		assert.deepEqual(seeks, [0.40800000000000003, 0.392, 0, 0.8]);
		await act(async () => reactProps(slider).onClick?.({ detail: 0, clientX: 0 }));
		assert.equal(seeks.at(-1), 0.4, 'native keyboard click keeps the selected position');
	} finally { await act(async () => root.unmount()); dom.restore(); }
});

test('crop margins position a rectangle relative to both actual pad dimensions', async () => {
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<DraggableCropOverlay label="Crop" crop={{ left: 0, right: 0, top: 0.341796875, bottom: 0.341796875 }} onCrop={() => undefined} />));
		const pad = dom.one('.kw-local-assistance__crop-overlay');
		assert.equal(reactProps(pad).style, undefined, 'vertical percentages cannot become width-based padding');
		const rectangle = pad.querySelector('span');
		assert.ok(rectangle);
		assert.deepEqual(reactProps(rectangle).style, { left: '0%', top: '34.1796875%', width: '100%', height: '31.640625%' });
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
