/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { COMPONENT_COPY } from '../vendor/audacity-design-system/components/src/component-copy.ts';

for (const entry of ['free text', 'digits', 'seconds digits']) for (const sampleRate of [44_100, 48_000, 96_000]) for (const type of ['tone', 'chirp', 'noise', 'silence']) test(`Generate ${type} at ${sampleRate} Hz retains an exact duration entered through ${entry}`, async () => {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const keys = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.add(listener); };
	document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.delete(listener); };
	let generatedFrames = 0;
	const controller = { project: { sampleRate, tracks: [], clips: [] }, actions: { generators: {
		generate: (generator: string, options: Readonly<Record<string, unknown>>) => {
			generatedFrames = generateAudioEditorSignal(generator, { ...options, sampleRate }).frameCount;
		},
	} } };
	try {
		await act(async () => { root.render(<GeneratorDialog type={type} controller={controller} snapshot={{}}
			copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => operation()} onClose={() => undefined} />); });
		const duration = dom.one('[data-generator-field="durationSeconds"]');
		const format = duration.querySelector('.timecode__format-button'); assert.ok(format);
		if (entry !== 'seconds digits') {
			await act(async () => { reactProps(format).onClick({ detail: 1 }); });
			const samples = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'samples'); assert.ok(samples);
			await act(async () => { reactProps(samples).onClick({}); });
		}
		if (entry === 'free text') {
			await act(async () => { reactProps(format).onClick({ detail: 1 }); });
			const enter = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === COMPONENT_COPY.enterValue); assert.ok(enter);
			await act(async () => { reactProps(enter).onClick({}); });
			const input = dom.one('.timecode__free-text');
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: '1' } }); });
			await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', stopPropagation() {}, preventDefault() {} }); });
		} else {
			const digits = duration.querySelectorAll('.timecode-digit'); assert.ok(digits[0]);
			digits[0].focus();
			await act(async () => { reactProps(digits[0]!).onClick(); });
			const text = entry === 'seconds digits' ? '000001000' : '1'.padStart(digits.length, '0');
			for (const [index, key] of [...text, 'Enter'].entries()) {
				await act(async () => {
					const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
					for (const listener of [...keys]) { if (typeof listener === 'function') listener(event); else listener.handleEvent(event); }
				});
				if (entry === 'seconds digits' && index === 4) {
					const generate = dom.container.querySelectorAll('button').find(button => button.textContent === ENGLISH_COPY.generate); assert.ok(generate);
					assert.equal(reactProps(generate).disabled, true, 'zero is an editable draft, not a valid generation');
					await act(async () => { reactProps(generate).onClick(); });
					assert.equal(generatedFrames, 0);
				}
			}
		}
		const generate = dom.container.querySelectorAll('button').find(button => button.textContent === ENGLISH_COPY.generate); assert.ok(generate);
		await act(async () => { reactProps(generate).onClick(); });
		assert.equal(generatedFrames, entry === 'seconds digits' ? sampleRate : 1,
			'the displayed duration must not retain an invisible minimum after typing through zero');
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
