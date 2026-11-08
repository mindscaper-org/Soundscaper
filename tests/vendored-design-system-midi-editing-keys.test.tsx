/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteGrid } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGrid.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

interface KeyRequest {
	readonly key: string;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly altKey?: boolean;
	readonly shiftKey?: boolean;
	readonly defaultPrevented?: boolean;
}

async function pressGridKey(request: KeyRequest) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const previousContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const root = createRoot(dom.container as unknown as Element);
	const result = { deleted: [] as number[][], selected: [] as { ids: number[]; additive: boolean | undefined }[],
		prevented: false, stopped: false };
	const noop = () => undefined;
	try {
		await act(async () => root.render(<NoteGrid clip={{ id: 1, name: 'Notes', start: 0, trimStart: 0, duration: 2, notes: [
			{ id: 1, pitch: 60, velocity: 100, startTime: 0, duration: .5, selected: true },
			{ id: 2, pitch: 64, velocity: 100, startTime: 1, duration: .5, selected: false },
		] }} width={800} height={200} bpm={120} beatsPerMeasure={4} pixelsPerSecond={100}
			scrollX={0} scrollY={1024} noteHeight={16} snap={{ subdivision: 4, triplet: false }} timeBasis="beats"
			onAddNote={noop} onUpdateNote={noop} onMoveNotes={noop} onResizeNote={noop} onSelectNote={noop}
			onDeleteNotes={ids => { result.deleted.push(ids); }}
			onSelectNotes={(ids, additive) => { result.selected.push({ ids, additive }); }}
			onDeselectAll={noop} onScrollYChange={noop} />));
		await act(async () => reactProps(dom.one('[tabindex="0"]')).onKeyDown!({
			ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, ...request,
			preventDefault() { result.prevented = true; }, stopPropagation() { result.stopped = true; },
		}));
		return result;
	} finally {
		await act(async () => root.unmount());
		if (previousContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', previousContext);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
}

for (const key of ['Delete', 'Backspace']) {
	for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'defaultPrevented'] as const) {
		test(`piano ${flag} ${key} leaves assigned or already-owned commands untouched`, async () => {
			const result = await pressGridKey({ key, [flag]: true });
			assert.deepEqual(result, { deleted: [], selected: [], prevented: false, stopped: false });
		});
	}
	test(`ordinary piano ${key} still deletes the selected note`, async () => {
		const result = await pressGridKey({ key });
		assert.deepEqual(result.deleted, [[1]]);
		assert.equal(result.stopped, true);
	});
}

for (const flag of ['ctrlKey', 'metaKey'] as const) test(`piano ${flag} Select All retains its note-selection policy`, async () => {
	const result = await pressGridKey({ key: 'a', [flag]: true });
	assert.deepEqual(result.selected, [{ ids: [2], additive: true }]);
	assert.deepEqual(result.deleted, []);
	assert.equal(result.prevented && result.stopped, true);
});

test('an already-prevented Select All does not change piano selection', async () => {
	const result = await pressGridKey({ key: 'a', ctrlKey: true, defaultPrevented: true });
	assert.deepEqual(result, { deleted: [], selected: [], prevented: false, stopped: false });
});
