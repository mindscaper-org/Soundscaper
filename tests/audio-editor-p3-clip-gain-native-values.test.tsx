/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipAudioSettingsMenu from '../src/common/editor/ui/inspector/ClipAudioSettingsMenu.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const gain of [16, .0001]) {
	test(`the gain dialog accepts the unchanged native gain ${gain} without authoring a rounded value`, async () => {
		const f = await fixture(gain);
		try {
			assert.equal(f.apply().hasAttribute('disabled'), false);
			await f.applyGain();
			assert.equal(Boolean(f.dialog()), false);
			assert.deepEqual(f.updates, []);
		} finally { await f.cleanup(); }
	});
}

test('the gain dialog permits 24.08 dB within the native maximum gain of sixteen', async () => {
	const f = await fixture(1);
	try {
		await f.type('24.08');
		assert.equal(f.apply().hasAttribute('disabled'), false);
		await f.applyGain();
		assert.deepEqual(f.updates, [{ gain: 10 ** (24.08 / 20) }]);
	} finally { await f.cleanup(); }
});

for (const value of ['', '25', '-61', 'NaN']) {
	test(`the gain dialog still refuses the newly typed invalid gain ${JSON.stringify(value)}`, async () => {
		const f = await fixture(16);
		try {
			await f.type(value);
			assert.equal(f.apply().hasAttribute('disabled'), true);
			await f.applyGain();
			assert.ok(f.dialog());
			assert.deepEqual(f.updates, []);
		} finally { await f.cleanup(); }
	});
}

async function fixture(gain: number) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const updates: Readonly<Record<string, unknown>>[] = [];
	const controller = { actions: { clip: { update: (_id: string, changes: Readonly<Record<string, unknown>>) => { updates.push(changes); } } } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<ClipAudioSettingsMenu controller={controller} clip={{ id: 'clip', gain }}
		copy={ENGLISH_COPY} disabled={false} effectsEnabled={true} run={operation => operation()} />));
	const trigger = dom.one('[data-clip-audio-settings]');
	await act(async () => reactProps(trigger).onClick({ currentTarget: trigger }));
	const gainItem = dom.container.querySelectorAll('[role="menuitem"]').find(node => node.textContent === 'Clip gain (dB)');
	assert.ok(gainItem);
	await act(async () => reactProps(gainItem).onClick({ stopPropagation() {} }));
	const dialog = () => dom.find('[role="dialog"]');
	const apply = () => {
		const button = dom.container.querySelectorAll('button').find(node => node.textContent === ENGLISH_COPY.channelMappingApply);
		assert.ok(button);
		return button;
	};
	return {
		updates, dialog, apply,
		applyGain: async () => { await act(async () => reactProps(apply()).onClick({})); },
		type: async (value: string) => {
			const input = dom.one('input');
			await act(async () => reactProps(input).onChange({ currentTarget: { value }, target: { value } }));
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
