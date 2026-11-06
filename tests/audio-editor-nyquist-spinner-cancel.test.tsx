/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NyquistNumberInput from '../src/common/editor/ui/dialogs/NyquistNumberInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface Fixture {
	readonly value: () => number;
	readonly focused: () => boolean;
	pointer(phase: 'Down' | 'Up', id?: number): Promise<void>;
	change(value: number): Promise<void>;
	key(key: string): Promise<void>;
	blur(): Promise<void>;
}

async function withField(check: (fixture: Fixture) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let value = 0;
	const render = (): void => root.render(<NyquistNumberInput value={value} minimum={-100} maximum={100}
		integer={false} disabled={false} onChange={next => { value = next; render(); }} />);
	try {
		await act(async () => render());
		const input = dom.one('input');
		await act(async () => { reactProps(input).onFocus!(); });
		await check({ value: () => value, focused: () => input.ownerDocument.activeElement === input,
			pointer: async (phase, id = 7) => { await act(async () => {
				reactProps(input)[`onPointer${phase}`]?.({ pointerId: id, button: 0, isPrimary: true,
					currentTarget: input, preventDefault() {} });
			}); },
			change: async next => { await act(async () => { reactProps(input).onChange!({
				currentTarget: { value: String(next), valueAsNumber: next },
			}); }); },
			key: async key => { await act(async () => { reactProps(input).onKeyDown!({
				key, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {},
			}); }); },
			blur: async () => { await act(async () => { reactProps(input).onBlur!(); }); },
		});
	} finally {
		await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
	}
}

test('a native spinner claims keyboard focus for Escape cancellation', async () => {
	await withField(async field => {
		assert.equal(field.focused(), false);
		await field.pointer('Down');
		assert.equal(field.focused(), true);
		await field.pointer('Up');
	});
});

test('Nyquist Escape rejects the remainder of a held native spinner until its release', async () => {
	await withField(async field => {
		await field.pointer('Down'); await field.change(2); await field.key('Escape');
		assert.equal(field.value(), 0);
		await field.change(3); await field.change(4);
		await field.pointer('Up'); await field.blur();
		assert.equal(field.value(), 0, 'native repeats cannot restart the canceled edit');
		await field.change(1); await field.key('Enter');
		assert.equal(field.value(), 1, 'fresh keyboard entry remains available after release');
	});
});

test('a foreign contact cannot retire the canceled Nyquist spinner owner', async () => {
	await withField(async field => {
		await field.pointer('Down'); await field.change(2); await field.key('Escape');
		await field.pointer('Up', 8); await field.change(3);
		assert.equal(field.value(), 0);
		await field.pointer('Up'); await field.change(1); await field.key('Enter');
		assert.equal(field.value(), 1);
	});
});

test('ordinary pointer release and caret clicks retain the existing Nyquist focus-session rollback', async () => {
	await withField(async field => {
		await field.pointer('Down'); await field.change(2); await field.pointer('Up');
		await field.pointer('Down', 8); await field.pointer('Up', 8); await field.change(3);
		await field.key('Escape'); await field.blur();
		assert.equal(field.value(), 0, 'caret repositioning does not commit the in-progress draft');
	});
});
