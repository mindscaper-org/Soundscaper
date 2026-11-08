/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { lightTheme } from '@audacity-ui/tokens';
import { ThemeProvider } from '../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';
import { NoteGridCanvas } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGridCanvas.tsx';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

for (const beatsPerMeasure of [1.5, 2.5]) for (const subdivision of [1, 4] as const) {
	test(`${beatsPerMeasure * 2}/8 grid paints every visible measure with subdivision${subdivision}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const priorContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
		const lines: { x: number; color: string }[] = [];
		let start = { x: 0, y: 0 }, end = { x: 0, y: 0 };
		const context = {
			strokeStyle: '', lineWidth: 1, fillStyle: '', scale() {}, clearRect() {}, fillRect() {}, beginPath() {},
			moveTo(x: number, y: number) { start = { x, y }; }, lineTo(x: number, y: number) { end = { x, y }; },
			stroke() { if (start.y === 0 && end.y === 100 && start.x === end.x) lines.push({ x: start.x, color: context.strokeStyle }); },
		};
		Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => context });
		try {
			await act(async () => { root.render(<ThemeProvider theme={lightTheme}><NoteGridCanvas width={400} height={100}
				scrollX={0} scrollY={960} noteHeight={16} pixelsPerSecond={100} bpm={120} beatsPerMeasure={beatsPerMeasure}
				snap={{ subdivision, triplet: false }} timeBasis="beats" /></ThemeProvider>); });
			const measures = lines.filter(line => line.color === lightTheme.audio.pianoRoll.gridMeasure).map(line => line.x);
			for (let index = 0; index * beatsPerMeasure * 50 <= 400; index++) {
				const x = index * beatsPerMeasure * 50;
				assert.equal(measures.filter(painted => Math.abs(painted - x) < .001).length, 1, `bar${index + 1} at${x}px paints exactly once`);
			}
		} finally {
			await act(async () => { root.unmount(); });
			if (priorContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', priorContext);
			else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
