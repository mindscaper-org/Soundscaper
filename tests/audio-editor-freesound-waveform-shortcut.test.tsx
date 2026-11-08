/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FreesoundResultRow } from '../src/common/editor/ui/workspace/FreesoundResultRow.tsx';
import type { FreesoundResultPresentation } from '../src/common/editor/ui/workspace/FreesoundPanel.tsx';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../src/common/i18n/freesound-attribution-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const result: FreesoundResultPresentation = {
	soundId: 42, name: 'Rain', username: 'field-recorder', soundUrl: 'https://freesound.org/s/42/',
	licenseCode: 'cc0', licenseName: 'Creative Commons 0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
	durationSeconds: 12, durationLabel: '12s', previewAvailable: true, waveformUrl: '/waveform',
};

for (const owner of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented', 'plain', 'shiftKey', 'home', 'end', 'space'] as const) {
	test(`Freesound waveform respects keyboard ownership for ${owner}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const prior = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const seeks: Array<readonly [number, number]> = [];
		try {
			await act(async () => root.render(<FreesoundResultRow result={result}
				copy={FREESOUND_ATTRIBUTION_ENGLISH_COPY} disabled={false} previewing={false} playing={false} positionSeconds={0}
				onPreview={() => undefined} onPausePreview={() => undefined} onResumePreview={() => undefined}
				onSeekPreview={(id, seconds) => { seeks.push([id, seconds]); }}
				onInsertAtPlayhead={() => undefined} onAddToProjectBin={() => undefined} />));
			const waveform = dom.one('[role="slider"]');
			let prevented = false;
			const key = owner === 'home' ? 'Home' : owner === 'end' ? 'End' : owner === 'space' ? ' ' : 'ArrowRight';
			await act(async () => reactProps(waveform).onKeyDown({ key, [owner]: true,
				preventDefault() { prevented = true; } }));
			if (owner === 'space') await act(async () => reactProps(waveform).onClick({ detail: 0 }));
			const owns = ['plain', 'shiftKey', 'home', 'end'].includes(owner);
			assert.equal(prevented, owns);
			const expected = owner === 'home' || owner === 'space' ? 0 : owner === 'end' ? 12 : owner === 'shiftKey' ? 1.2 : .12;
			assert.deepEqual(seeks, owns || owner === 'space' ? [[42, expected]] : []);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = prior;
			dom.restore();
		}
	});
}
