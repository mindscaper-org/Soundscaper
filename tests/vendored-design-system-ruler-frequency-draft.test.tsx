/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RulerFlyout } from '../vendor/audacity-design-system/components/src/RulerFlyout/RulerFlyout.tsx';
import { ComponentCopyProvider } from '../vendor/audacity-design-system/components/src/contexts/ComponentCopyContext.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('frequency typing stays a draft while button and keyboard stepping commit once', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = environment.IS_REACT_ACT_ENVIRONMENT; environment.IS_REACT_ACT_ENVIRONMENT = true;
	const writes: number[] = [];
	function Fixture() {
		const [maximum, setMaximum] = useState(20_000);
		return <ComponentCopyProvider copy={{ minimum: 'Min', maximum: 'Max' }} locale="en">
			<RulerFlyout isOpen x={8} y={8} mode="spectrogram" sampleRate={48_000} minFreq={0} maxFreq={maximum}
				onClose={() => undefined} onMaxFreqChange={next => { writes.push(next); setMaximum(next); }} />
		</ComponentCopyProvider>;
	}
	try {
		await act(async () => root.render(<Fixture />));
		const field = dom.container.querySelectorAll('input').find(input => input.getAttribute('aria-label') === 'Max');
		assert.ok(field);
		const stepper = field.closest('.number-stepper'); assert.ok(stepper);
		const owner = dom.container.querySelectorAll('div').find(element => element.childNodes.includes(stepper)); assert.ok(owner);
		field.focus();
		for (const value of ['', '1', '12', '120', '1200', '12000']) {
			await act(async () => reactProps(field).onChange!({ target: { value } }));
		}
		assert.deepEqual(writes, [], 'intermediate integers must not publish stale external values back into later typing');
		assert.equal(field.value, '12000');
		await act(async () => reactProps(owner).onKeyDown!({ key: 'Enter', nativeEvent: { isComposing: false } }));
		assert.deepEqual(writes, [12000]);
		const up = stepper.querySelector('.number-stepper__arrow--up'); assert.ok(up);
		await act(async () => reactProps(up).onClick!());
		assert.deepEqual(writes, [12000, 12100], 'one arrow click publishes exactly one stepped value');
		await act(async () => reactProps(field).onClick!());
		await act(async () => reactProps(field).onKeyDown!({ key: 'ArrowUp', preventDefault() {} }));
		assert.deepEqual(writes, [12000, 12100, 12200], 'the existing keyboard step remains immediate');
		await act(async () => reactProps(field).onChange!({ target: { value: '13000' } }));
		await act(async () => reactProps(owner).onBlur!({ currentTarget: owner, relatedTarget: up }));
		assert.deepEqual(writes, [12000, 12100, 12200], 'moving within the same field does not publish its unconfirmed draft');
		await act(async () => reactProps(up).onClick!());
		assert.deepEqual(writes, [12000, 12100, 12200, 13100]);
		await act(async () => reactProps(field).onChange!({ target: { value: '' } }));
		assert.equal(field.value, '');
		await act(async () => reactProps(owner).onBlur!({ currentTarget: owner, relatedTarget: null }));
		assert.equal(field.value, '13100');
		assert.equal(writes.length, 4);
	} finally {
		await act(async () => root.unmount()); environment.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
	}
});
