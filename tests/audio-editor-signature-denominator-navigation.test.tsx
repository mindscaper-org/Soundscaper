/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MusicalTimelineControls } from '../src/common/editor/ui/toolbar/MusicalTimelineControls.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { MUSICAL_TIMELINE_COPY_BY_LOCALE } from '../src/common/i18n/musical-timeline-copy.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

interface Harness {
	readonly dom: ReturnType<typeof installReactTestDom>;
	readonly commits: readonly number[];
	render(): Promise<void>;
	setDenominator(value: number): Promise<void>;
}

async function withToolbar(body: (harness: Harness) => Promise<void>, blocked = false): Promise<void> {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const createElement = dom.container.ownerDocument.createElement.bind(dom.container.ownerDocument);
	dom.container.ownerDocument.createElement = (tagName: string) => {
		const element = createElement(tagName);
		if (tagName === 'option') Object.defineProperty(element, 'value', { configurable: true,
			get: () => element.getAttribute('value') ?? element.textContent,
			set: (value: string) => { element.attributes.set('value', String(value)); },
		});
		if (tagName === 'select') Object.defineProperty(element, 'value', { configurable: true,
			get: () => element.options.find(option => option.selected)?.value ?? '',
			set: (value: string) => { for (const option of element.options) option.selected = option.value === String(value); },
		});
		return element;
	};
	const nativeFormData = globalThis.FormData;
	const previousFormData = Object.getOwnPropertyDescriptor(globalThis, 'FormData');
	Object.defineProperty(globalThis, 'FormData', { configurable: true, value: class extends nativeFormData {
		constructor(form?: HTMLFormElement) {
			super();
			for (const field of form?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select') ?? []) {
				if (field.name && !field.disabled) this.append(field.name, field.value);
			}
		}
	} });
	const elementPrototype = Reflect.getPrototypeOf(dom.container);
	assert.ok(elementPrototype);
	const previousReset = Object.getOwnPropertyDescriptor(elementPrototype, 'reset');
	Object.defineProperty(elementPrototype, 'reset', { configurable: true, value(this: ReactTestElement): void {
		for (const field of this.querySelectorAll('input, select')) {
			if (field.tagName === 'SELECT') {
				const original = field.options.find(option => Reflect.get(option, 'defaultSelected') === true) ?? field.options[0];
				field.value = original?.value ?? '';
				continue;
			}
			const initial: unknown = Reflect.get(reactProps(field), 'defaultValue');
			if (initial !== undefined) field.value = String(initial);
		}
	} });
	const root = createRoot(dom.container as unknown as Element);
	let signature = { id: 'signature-root', bar: 0, numerator: 4, denominator: 4 };
	let project = createSoundscaperProject({ id: 'denominator-navigation', signatureMap: { events: [signature] } });
	const commits: number[] = [];
	const replaceDenominator = (denominator: number): void => {
		signature = { ...signature, denominator };
		project = createSoundscaperProject({ ...project,
			tempo: { ...project.tempo, timeSignature: { ...project.tempo.timeSignature, denominator } },
			signatureMap: { ...project.signatureMap, events: [signature] },
		});
	};
	const controller = { actions: { project: {
		updateSignatureEvent(id: string, changes: { readonly denominator: number }): void {
			assert.equal(id, signature.id);
			commits.push(changes.denominator);
			replaceDenominator(changes.denominator);
		},
	} } };
	const render = async (): Promise<void> => {
		await act(async () => root.render(<MusicalTimelineControls project={project} snapshot={{ readOnly: blocked, recording: false }}
			controller={controller} copy={{ ...ENGLISH_COPY, ...MUSICAL_TIMELINE_COPY_BY_LOCALE.en }} run={(operation: () => unknown) => operation()} />));
	};
	try { await render(); await body({ dom, commits, render, setDenominator: async value => { replaceDenominator(value); await render(); } }); }
	finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		if (previousReset) Object.defineProperty(elementPrototype, 'reset', previousReset);
		else Reflect.deleteProperty(elementPrototype, 'reset');
		if (previousFormData) Object.defineProperty(globalThis, 'FormData', previousFormData);
		else Reflect.deleteProperty(globalThis, 'FormData');
		dom.restore();
	}
}

function denominator(dom: Harness['dom']): ReactTestElement {
	const field = dom.container.querySelectorAll('select').find(element => element.getAttribute('aria-label') === 'Time signature: denominator');
	assert.ok(field, 'the denominator must offer actual admitted choices instead of invalid +/-1 drafts');
	return field;
}

test('the signature denominator exposes every safe power of two and no refused next steps', async () => {
	await withToolbar(async ({ dom }) => {
		assert.deepEqual(denominator(dom).querySelectorAll('option').map(option => Number(option.getAttribute('value'))),
			Array.from({ length: 53 }, (_, exponent) => 2 ** exponent));
		const numerator = dom.container.querySelectorAll('input').find(element => element.getAttribute('aria-label') === 'Time signature: numerator');
		assert.ok(numerator);
		assert.equal(numerator.type, 'number', 'ordinary integer stepping remains native');
	});
});

test('a denominator choice commits once on Enter and later blur preserves that project value', async () => {
	await withToolbar(async ({ dom, commits, render }) => {
		const field = denominator(dom);
		field.focus(); field.value = '8';
		assert.deepEqual(commits, []);
		await act(async () => reactProps(field).onKeyDown!({ key: 'Enter', nativeEvent: { isComposing: false }, currentTarget: field, preventDefault() {} }));
		await render();
		await act(async () => reactProps(denominator(dom)).onBlur!({ currentTarget: denominator(dom) }));
		assert.deepEqual(commits, [8]);
	});
});

test('Escape restores the saved choice and composing confirmation does not publish it', async () => {
	await withToolbar(async ({ dom, commits }) => {
		const field = denominator(dom);
		field.focus(); field.value = '8';
		await act(async () => reactProps(field).onKeyDown!({ key: 'Enter', nativeEvent: { isComposing: true }, currentTarget: field, preventDefault() { assert.fail('native composition must remain untouched'); } }));
		assert.deepEqual(commits, []);
		assert.equal(field.value, '8');
		await act(async () => reactProps(field).onKeyDown!({ key: 'Escape', nativeEvent: { isComposing: false }, currentTarget: field }));
		assert.equal(field.value, '4');
		assert.deepEqual(commits, []);
	});
});

test('read-only editing disables denominator navigation', async () => {
	await withToolbar(async ({ dom }) => { assert.equal(denominator(dom).hasAttribute('disabled'), true); }, true);
});

test('the authored signature event form offers the same named denominator choices', async () => {
	await withToolbar(async ({ dom }) => {
		const trigger = dom.container.querySelectorAll('button').find(element => element.getAttribute('aria-label') === 'Musical timeline');
		assert.ok(trigger);
		await act(async () => reactProps(trigger).onClick!({ nativeEvent: { detail: 1 } }));
		const form = dom.container.querySelectorAll('form').find(element => element.getAttribute('aria-label') === 'Time signature event 1');
		assert.ok(form);
		const field = form.querySelectorAll('select').find(element => element.name === 'denominator');
		assert.ok(field);
		assert.equal(field.value, '4');
		assert.deepEqual(field.querySelectorAll('option').map(option => Number(option.getAttribute('value'))),
			Array.from({ length: 53 }, (_, exponent) => 2 ** exponent));
	});
});

test('accepted form choices survive native reset, undo and redo without replacing the focused control', async () => {
	await withToolbar(async ({ dom, commits, render, setDenominator }) => {
		const trigger = dom.container.querySelectorAll('button').find(element => element.getAttribute('aria-label') === 'Musical timeline'); assert.ok(trigger);
		await act(async () => reactProps(trigger).onClick!({ nativeEvent: { detail: 1 } }));
		const form = dom.container.querySelectorAll('form').find(element => element.getAttribute('aria-label') === 'Time signature event 1'); assert.ok(form);
		const field = form.querySelectorAll('select').find(element => element.name === 'denominator'); assert.ok(field);
		const save = form.querySelectorAll('button').find(element => element.textContent === 'Save'); assert.ok(save);
		field.value = '8'; save.focus();
		await act(async () => reactProps(form).onSubmit!({ currentTarget: form, preventDefault() {} }));
		await render();
		assert.deepEqual(commits, [8]);
		assert.equal(field.value, '8', 'form.reset must retain the newly accepted choice');
		assert.strictEqual(dom.container.ownerDocument.activeElement, save);
		await setDenominator(4);
		assert.equal(field.value, '4');
		assert.strictEqual(dom.container.ownerDocument.activeElement, save);
		await setDenominator(8);
		assert.equal(field.value, '8');
		assert.strictEqual(dom.container.ownerDocument.activeElement, save);
	});
});
