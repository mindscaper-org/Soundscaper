/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteGrid } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGrid.tsx';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

test('growing a piano-roll viewport reconciles its existing bottom pitch scroll limit', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const descriptor = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const root = createRoot(dom.container as unknown as Element);
	const noop = () => undefined;
	function Grid({ height }: { readonly height: number }) {
		const [scrollY, setScrollY] = useState(2048 - 144);
		return <NoteGrid clip={{ id: 1, name: 'Notes', start: 0, duration: 1, trimStart: 0,
			notes: [{ id: 1, pitch: 0, startTime: 0, duration: 0.5, velocity: 100 }] }} width={800} height={height}
			bpm={120} beatsPerMeasure={4} pixelsPerSecond={100} scrollX={0} scrollY={scrollY} noteHeight={16}
			snap={{ subdivision: 4, triplet: false }} timeBasis="beats" onAddNote={noop} onDeleteNotes={noop}
			onUpdateNote={noop} onMoveNotes={noop} onResizeNote={noop} onSelectNote={noop} onSelectNotes={noop}
			onDeselectAll={noop} onScrollYChange={setScrollY} />;
	}
	try {
		await act(async () => root.render(<Grid height={144} />));
		const top = () => (reactProps(dom.one('[data-note-id="1"]')) as unknown as { style: React.CSSProperties }).style.top;
		assert.equal(top(), 129);
		await act(async () => root.render(<Grid height={192} />));
		assert.equal(top(), 177, 'MIDI pitch0 remains on the bottom visible row after growth');
	} finally {
		await act(async () => root.unmount());
		if (descriptor) Object.defineProperty(ReactTestElement.prototype, 'getContext', descriptor);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
});
