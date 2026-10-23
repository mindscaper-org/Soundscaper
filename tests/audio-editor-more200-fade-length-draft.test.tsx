/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipFadesDialog from '../src/common/editor/ui/timeline/ClipFadesDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const draft of ['0.', '0.125', '0.0005', '', '1e', '-', '.']) test(`Fades retains the typed draft ${JSON.stringify(draft)} without rounding or deleting audio`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const previews: Array<{ fadeInFrames?: number }> = [];
	try {
		await act(async () => root.render(<ClipFadesDialog clip={{ id: 'take', timelineStartFrame: 0, durationFrames: 48_000, fadeInFrames: 2400 }}
			portalHost={dom.container as unknown as Element} sampleRate={48_000} copy={ENGLISH_COPY} blocked={false} onPreview={value => { previews.push(value); }} onApply={() => undefined} onClose={() => undefined} />));
		const field = dom.one('.number-stepper__input');
		await act(async () => reactProps(field).onChange({ target: { value: draft } }));
		assert.equal(reactProps(field).value, draft);
		if (!draft || !Number.isFinite(Number(draft))) {
			assert.equal(previews.at(-1)?.fadeInFrames, undefined, 'an incomplete draft must not erase the existing fade');
			const apply = dom.container.querySelectorAll('button').find(button => button.textContent === 'Apply');
			assert.ok(apply); assert.equal(reactProps(apply).disabled, true);
		}
		else assert.equal(previews.at(-1)?.fadeInFrames, Math.round(Number(draft) * 48_000));
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
