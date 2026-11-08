/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LabeledRadio } from '../vendor/audacity-design-system/components/src/LabeledRadio/LabeledRadio.tsx';
import { GeneratorRadioGroup } from '../src/common/editor/ui/dialogs/GeneratorDialogFields.jsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const target of ['label', 'description', 'circle', 'checked', 'disabled'] as const) {
	test(`labeled radio pointer activation preserves one choice callback: ${target}`, async () => {
		await mounted(async dom => {
			const changes: boolean[] = [];
			function View() {
				const [checked, setChecked] = useState(target === 'checked');
				return <LabeledRadio label="Linear" bold description="Linear amplitude" checked={checked}
					disabled={target === 'disabled'} onChange={(next: boolean) => { changes.push(next); setChecked(next); }} />;
			}
			await dom.render(<View />);
			const radio = dom.one('[role="radio"]');
			const node = target === 'circle' ? radio
				: dom.one(target === 'description' ? '.labeled-radio__description' : '.labeled-radio__label');
			await act(async () => bubbleClick(node));
			assert.deepEqual(changes, target === 'checked' || target === 'disabled' ? [] : [true]);
			assert.equal(radio.getAttribute('aria-checked'), target === 'disabled' ? 'false' : 'true');
			if (target !== 'circle' && target !== 'disabled') assert.strictEqual(document.activeElement, radio);
		});
	});
}

test('the generator label selects once through the shared radio wrapper', async () => {
	await mounted(async dom => {
		const changes: string[] = [];
		function View() {
			const [value, setValue] = useState('logarithmic');
			return <GeneratorRadioGroup label="Interpolation" value={value}
				options={[["linear", "Linear"], ["logarithmic", "Logarithmic"]]}
				onChange={(next: string) => { changes.push(next); setValue(next); }} />;
		}
		await dom.render(<View />);
		const label = dom.container.querySelectorAll('label').find(node => node.textContent === 'Linear');
		assert.ok(label);
		await act(async () => bubbleClick(label));
		assert.deepEqual(changes, ['linear']);
		assert.equal(dom.one('[aria-label="Linear"]').getAttribute('aria-checked'), 'true');
	});
});

function bubbleClick(target: ReactTestElement): void {
	let stopped = false;
	const event = { target, stopPropagation() { stopped = true; } };
	for (let node: ReactTestElement | null = target; node && !stopped;
		node = node.parentNode instanceof ReactTestElement ? node.parentNode : null) {
		if (Reflect.ownKeys(node).some(key => typeof key === 'string' && key.startsWith('__reactProps$'))) {
			reactProps(node).onClick?.(event);
		}
	}
}

async function mounted(run: (dom: ReturnType<typeof installReactTestDom> & {
	render(view: React.ReactNode): Promise<void>;
}) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	try {
		await run({ ...dom, render: async view => { await act(async () => root.render(view)); } });
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = prior;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}
