/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteGrid } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGrid.tsx';
import { PianoRollClipStrip } from '../vendor/audacity-design-system/components/src/PianoRoll/PianoRollClipStrip.tsx';
import type { MidiNote } from '../vendor/audacity-design-system/core/src/types/index.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

for (const surface of ['placement', 'grid-boundary', 'strip-boundary', 'marquee'] as const) test(`held MIDI ${surface} follows the current viewport after a pan or zoom`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const context = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const entries = listeners.get(type) ?? new Set<EventListener>(); entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener === 'function') listeners.get(type)?.delete(listener);
	};
	const added: MidiNote[] = [], durations: number[] = [], selected: number[][] = [];
	const noop = () => undefined;
	let changeView: (scrollX: number, pixelsPerSecond: number) => void = noop;
	function Grid() {
		const [scrollX, setScrollX] = useState(0), [pixelsPerSecond, setPixelsPerSecond] = useState(100);
		changeView = (scroll, scale) => { setScrollX(scroll); setPixelsPerSecond(scale); };
		const clip = { id: 1, name: 'Notes', start: 0, duration: 2, trimStart: 0,
			notes: surface === 'marquee' ? [{ id: 1, startTime: 1, duration: 0.5, pitch: 60, velocity: 100 }] : [] };
		const resize = (_edge: 'left' | 'right', _start: number, duration: number) => { durations.push(duration); };
		return surface === 'strip-boundary' ? <PianoRollClipStrip clips={[clip]} activeClipId={1} width={800}
			pixelsPerSecond={pixelsPerSecond} scrollX={scrollX} bpm={120} snap={{ subdivision: 4, triplet: false }} onResizeClip={resize} />
			: <NoteGrid clip={clip} width={800} height={200} bpm={120} beatsPerMeasure={4} pixelsPerSecond={pixelsPerSecond}
				scrollX={scrollX} scrollY={1024} noteHeight={16} snap={{ subdivision: 4, triplet: false }} timeBasis="beats"
				onAddNote={note => { added.push(note); }} onDeleteNotes={noop} onUpdateNote={noop} onMoveNotes={noop}
				onResizeNote={noop} onSelectNote={noop} onSelectNotes={ids => { selected.push([...ids]); }} onDeselectAll={noop} onScrollYChange={noop}
				onResizeClip={resize} />;
	}
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Grid />));
		const target = surface === 'strip-boundary' ? dom.container.querySelectorAll('div').find(node => {
			const style = (reactProps(node) as unknown as { style?: React.CSSProperties }).style;
			return style?.right === 0 && style.width === 6;
		}) : dom.one('[tabindex="0"]');
		assert.ok(target);
		const marquee = surface === 'marquee';
		const clientX = marquee ? 80 : surface === 'placement' ? 150 : 200;
		await act(async () => { reactProps(target).onMouseDown?.({ currentTarget: target, button: 0, ctrlKey: marquee, clientX, clientY: marquee ? 43 : 100,
			preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { changeView(marquee ? 128 : 50, marquee ? 260 : 100); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: marquee ? 110 : clientX + 25, clientY: marquee ? 68 : 100 } as MouseEvent); });
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({ button: 0 } as MouseEvent); });
		if (marquee) assert.deepEqual(selected, []);
		else if (surface === 'placement') assert.equal(added[0]?.startTime, 2.25);
		else assert.equal(durations.at(-1), 2.75);
	} finally {
		await act(async () => root.unmount());
		if (context) Object.defineProperty(ReactTestElement.prototype, 'getContext', context); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
});
