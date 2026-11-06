/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import type { AudioEditorEditBlockingSnapshot } from '../src/common/editor/edit-blocking.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const type of ['morse', 'dtmf'] as const) test(`${type} text entry has its existing Generate button as a native form submitter`, async context => {
	const f = await mount(context, { type });
	const id = f.form().getAttribute('id');
	assert.equal(f.button('Generate').getAttribute('type'), 'submit');
	assert.ok(id, 'the form has an authoring-instance identity');
	assert.equal(f.button('Generate').getAttribute('form'), id);
	await f.setMessage(type === 'morse' ? 'EE' : '12');
	assert.equal(f.form().getAttribute('id'), id, 'typing retains its native submitter association');
});

test('footer activation and native form submission publish only one generation', async context => {
	const f = await mount(context);
	await f.clickGenerate(true);
	assert.equal(f.requests.length, 1);
	assert.equal(f.closes(), 1);
});

test('explicit native request submission retains the existing guarded generation path', async context => {
	const f = await mount(context);
	await f.submit();
	assert.equal(f.requests.length, 1);
	assert.equal(f.closes(), 1);
});

for (const snapshot of [{ readOnly: true }, { exporting: true }, { recording: true }]) test(`native generator submit keeps blocked admission ${JSON.stringify(snapshot)}`, async context => {
	const f = await mount(context, { snapshot });
	assert.equal(f.button('Generate').hasAttribute('disabled'), true);
	await f.clickGenerate(true); await f.submit();
	assert.equal(f.requests.length, 0);
	assert.equal(f.closes(), 0);
	assert.equal(f.button('Cancel').hasAttribute('disabled'), false);
	await f.cancel(); assert.equal(f.closes(), 1);
});

test('native submission cannot send a Morse draft with unsupported characters', async context => {
	const f = await mount(context);
	await f.setMessage('EE ✳');
	assert.equal(f.button('Generate').hasAttribute('disabled'), true);
	await f.clickGenerate(true); await f.submit();
	assert.equal(f.requests.length, 0);
});

test('pending generation blocks duplicate submit and cancellation retains its operation owner', async context => {
	const f = await mount(context, { pending: true });
	await f.clickGenerate(true); await f.submit();
	assert.equal(f.requests.length, 1);
	assert.equal(f.button('Generate').hasAttribute('disabled'), true);
	await f.clickGenerate(true); await f.submit();
	assert.equal(f.requests.length, 1);
	await f.cancel(); assert.equal(f.closes(), 1);
	const signal = f.requests[0]?.signal; assert.ok(signal instanceof AbortSignal);
	assert.equal(signal.aborted, true);
	await f.release(); assert.equal(f.closes(), 1, 'retired completion cannot close the dialog again');
});

async function mount(context: TestContext, options: Readonly<{
	type?: 'morse' | 'dtmf'; pending?: boolean; snapshot?: AudioEditorEditBlockingSnapshot;
}> = {}) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const root = createRoot(dom.container as unknown as Element);
	let release = () => {};
	const gate = new Promise<void>(resolve => { release = resolve; });
	const requests: Readonly<Record<string, unknown>>[] = [];
	let closes = 0;
	context.after(async () => {
		release(); await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	});
	const controller = { project: createSoundscaperProject({ id: 'native-generator-form', sampleRate: 8000 }), actions: {
		generators: { async generate(_type: string, requested: Readonly<Record<string, unknown>>) { requests.push(requested); if (options.pending) await gate; } },
	} };
	await act(async () => root.render(<GeneratorDialog type={options.type ?? 'morse'} controller={controller}
		snapshot={options.snapshot ?? {}} copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => operation()}
		onClose={() => { closes += 1; }} />));
	const form = () => dom.one('form');
	const button = (label: string) => {
		const found = dom.container.querySelectorAll('button').find(item => item.textContent?.trim() === label);
		assert.ok(found, `Expected existing ${label} button`); return found;
	};
	return { form, button, requests, closes: () => closes,
		async setMessage(value: string) {
			const field = dom.one(`[data-generator-field="${options.type === 'dtmf' ? 'sequence' : 'text'}"]`).querySelector('input');
			assert.ok(field);
			await act(async () => reactProps(field).onChange?.({ target: { value } }));
		},
		async clickGenerate(includeNativeDefault: boolean) {
			await act(async () => {
				let prevented = false;
				reactProps(button('Generate')).onClick?.({ preventDefault() { prevented = true; } });
				if (includeNativeDefault && !prevented) reactProps(form()).onSubmit?.({ preventDefault() {} });
			});
		},
		async submit() { await act(async () => reactProps(form()).onSubmit?.({ preventDefault() {} })); },
		async cancel() { await act(async () => reactProps(button('Cancel')).onClick?.()); },
		async release() { await act(async () => { release(); await gate; }); },
	};
}
