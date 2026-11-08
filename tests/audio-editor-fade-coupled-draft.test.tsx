/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipFadesDialog from '../src/common/editor/ui/timeline/ClipFadesDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

type Edge = 'in' | 'out';
type Changes = Parameters<React.ComponentProps<typeof ClipFadesDialog>['onApply']>[0];

for (const edited of ['in', 'out'] as const) for (const oppositeDraft of ['0.800', '0,8 s']) {
	test(`editing fade-${edited} reports the pushed opposite length after its valid ${oppositeDraft} draft`, async () => {
		await withDialog(async f => {
			const opposite = edited === 'in' ? 'out' : 'in';
			await f.edit(opposite, oppositeDraft);
			assert.equal(f.text(edited), '0.002', 'a non-overlapping edit retains the initial microfade');
			await f.edit(edited, '0.8');
			assert.equal(f.text(edited), '0.8', 'the actively edited draft is retained');
			assert.equal(f.text(opposite), '0.2', 'the opposite field reports the actual pushed length');
			await f.apply();
			assert.equal(f.applied.length, 1);
			assert.equal(f.applied[0]?.[edited === 'in' ? 'fadeInFrames' : 'fadeOutFrames'], 38_400);
			assert.equal(f.applied[0]?.[opposite === 'in' ? 'fadeInFrames' : 'fadeOutFrames'], 9_600);
		});
	});
}

for (const incomplete of ['', '-', '1e', '1.001']) {
	test(`pushing fade-out preserves its incomplete or rejected draft ${JSON.stringify(incomplete)}`, async () => {
		await withDialog(async f => {
			await f.edit('out', '0.8');
			await f.edit('out', incomplete);
			await f.edit('in', '0.8');
			assert.equal(f.text('out'), incomplete);
			assert.equal(f.previews.at(-1)?.fadeOutFrames, 9_600, 'the valid preview still follows the fade-window rule');
			assert.equal(f.applyDisabled(), true, 'an unfinished field cannot silently publish the preview');
			await f.edit('out', '0.1');
			assert.equal(f.applyDisabled(), false, 'completing the existing field remains possible');
			await f.apply();
			assert.equal(f.applied[0]?.fadeOutFrames, 4_800);
		});
	});
}

test('ordinary non-overlapping typing retains both raw valid drafts', async () => {
	await withDialog(async f => {
		await f.edit('out', '0.200 s');
		for (const draft of ['0', '0.', '0.1']) {
			await f.edit('in', draft);
			assert.equal(f.text('in'), draft);
			assert.equal(f.text('out'), '0.200 s');
		}
		await f.apply();
		assert.equal(f.applied[0]?.fadeInFrames, 4_800);
		assert.equal(f.applied[0]?.fadeOutFrames, 9_600);
	});
});

async function withDialog(run: (fixture: {
	readonly applied: Changes[];
	readonly previews: Changes[];
	readonly text: (edge: Edge) => string;
	readonly edit: (edge: Edge, draft: string) => Promise<void>;
	readonly apply: () => Promise<void>;
	readonly applyDisabled: () => boolean;
}) => Promise<void>) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const applied: Changes[] = [], previews: Changes[] = [];
	try {
		await act(async () => root.render(<ClipFadesDialog
			clip={{ id: 'take', timelineStartFrame: 0, durationFrames: 48_000, fadeInFrames: 96, fadeOutFrames: 96 }}
			portalHost={dom.container as unknown as Element} sampleRate={48_000} copy={ENGLISH_COPY} blocked={false}
			onPreview={changes => { previews.push(changes); }} onApply={changes => { applied.push(changes); }} onClose={() => undefined} />));
		const field = (edge: Edge) => dom.container.querySelectorAll('.number-stepper__input')[edge === 'in' ? 0 : 1]!;
		const apply = dom.container.querySelectorAll('button').find(button => button.textContent === 'Apply');
		assert.ok(apply);
		await run({ applied, previews, text: edge => String(reactProps(field(edge)).value),
			edit: async (edge, draft) => { await act(async () => { reactProps(field(edge)).onChange({ target: { value: draft } }); }); },
			apply: async () => { await act(async () => { reactProps(apply).onClick(); }); },
			applyDisabled: () => apply.hasAttribute('disabled'),
		});
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
}
