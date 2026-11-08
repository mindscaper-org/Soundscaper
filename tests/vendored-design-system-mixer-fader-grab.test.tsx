/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MixerFader } from '../vendor/audacity-design-system/components/src/MixerFader/MixerFader.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface Pointer {
	readonly pointerId: number;
	readonly pointerType: string;
	readonly button: number;
	readonly buttons: number;
	readonly isPrimary: boolean;
	readonly clientY: number;
	preventDefault(): void;
}

interface FaderActions {
	readonly calls: Readonly<{ phase: string; value: number }>[];
	down(y: number, changes?: Partial<Pointer>): Promise<void>;
	move(y: number, changes?: Partial<Pointer>): Promise<void>;
	up(y: number, changes?: Partial<Pointer>): Promise<void>;
}

async function withFader(check: (actions: FaderActions) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const calls: { phase: string; value: number }[] = [];
	function Fader() {
		const [value, setValue] = useState(0);
		return <MixerFader value={value}
			onGestureStart={value => { calls.push({ phase: 'start', value }); }}
			onChange={value => { calls.push({ phase: 'preview', value }); setValue(value); }}
			onGestureEnd={value => { calls.push({ phase: 'commit', value }); }} />;
	}
	try {
		await act(async () => root.render(<Fader />));
		const track = dom.one('.mixer-fader__track');
		Object.defineProperties(track, {
			getBoundingClientRect: { value: () => ({ top: 100, height: 144 }) },
			setPointerCapture: { value: () => undefined },
			hasPointerCapture: { value: () => true },
			releasePointerCapture: { value: () => undefined },
		});
		const dispatch = async (name: string, clientY: number, changes: Partial<Pointer> = {}): Promise<void> => {
			await act(async () => reactProps(track)[name]!({ pointerId: 7, pointerType: 'mouse', button: 0,
				buttons: name === 'onPointerUp' ? 0 : 1, isPrimary: true, clientY, preventDefault() {}, ...changes }));
		};
		await check({ calls, down: (y, changes) => dispatch('onPointerDown', y, changes),
			move: (y, changes) => dispatch('onPointerMove', y, changes),
			up: (y, changes) => dispatch('onPointerUp', y, changes) });
	} finally {
		await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
	}
}

for (const y of [111, 137]) test(`a no-motion fader grab at handle coordinate ${y} keeps its gain`, async () => {
	await withFader(async ({ calls, down, up }) => {
		await down(y); await up(y);
		assert.ok(calls.length > 0);
		assert.ok(calls.every(call => call.value === 0), 'the handle must remain under the grabbed point');
	});
});

test('an off-center handle drag changes gain only by its physical movement', async () => {
	await withFader(async ({ calls, down, move, up }) => {
		await down(111); await move(119); await up(119);
		assert.deepEqual(calls, [{ phase: 'start', value: 0 }, { phase: 'preview', value: 0 },
			{ phase: 'preview', value: -4 }, { phase: 'commit', value: -4 }]);
	});
});

test('an exposed-track click retains its absolute setting behavior', async () => {
	await withFader(async ({ calls, down, up }) => {
		await down(200); await up(200);
		assert.deepEqual(calls, [{ phase: 'start', value: 0 }, { phase: 'preview', value: -38 }, { phase: 'commit', value: -38 }]);
	});
});

test('another contact cannot replace the admitted handle grab offset', async () => {
	await withFader(async ({ calls, down, move, up }) => {
		await down(111); await down(220, { pointerId: 8, isPrimary: false });
		await move(119); await up(119);
		assert.equal(calls.at(-1)?.value, -4);
	});
});
