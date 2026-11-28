/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

import type { TracktionClipCommand } from '../src/soundscaper/tracktion-project-contract.ts';
import { TracktionClipEditDialog } from '../src/soundscaper/ui/TracktionClipEditDialog.tsx';

async function mountEditor(context: TestContext, embedded = false) {
	const { window: host } = new JSDOM('<main></main><iframe></iframe>');
	const window = embedded ? host.document.querySelector('iframe')?.contentWindow as (Window & typeof globalThis) | null : host;
	assert.ok(window);
	Object.defineProperty(window.HTMLDialogElement.prototype, 'showModal', { value(this: HTMLDialogElement) { this.open = true; } });
	const { document } = window;
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ React, window, document, Element: window.Element,
		HTMLInputElement: window.HTMLInputElement, FormData: window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, value });
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(document.body);
	context.after(async () => {
		await act(async () => root.unmount());
		host.close();
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	});
	return { window, document, root };
}

void test('the clip edit dialog reuses its options while changing selection and retrying', async (context) => {
	const { window, document, root } = await mountEditor(context);
	let clipLabelsRead = 0;
	let trackLabelsRead = 0;
	const clips = Array.from({ length: 768 }, (_, index) => ({ id: String(index), start: index * 128, end: index * 128 + 64,
		sourceOffset: 0, get name() { clipLabelsRead += 1; return `Clip ${index}`; } }));
	const tracks = [{ id: 'source', clipCount: clips.length, get name() { trackLabelsRead += 1; return 'Source'; } },
		{ id: 'destination', clipCount: 0, get name() { trackLabelsRead += 1; return 'Destination'; } }];
	const commands: TracktionClipCommand[] = [];
	const onApply = (command: TracktionClipCommand) => { commands.push(command); };
	const onDismiss = () => assert.fail('The dialog should remain open');
	const render = (busy: boolean, failure = '') => act(async () => root.render(<TracktionClipEditDialog kind="moveClip"
		clips={clips} tracks={tracks} sourceTrackId="source" busy={busy} failure={failure} onApply={onApply} onDismiss={onDismiss} />));
	await render(false);
	assert.equal(clipLabelsRead, 768);
	assert.equal(trackLabelsRead, 2);
	const picker = document.querySelector<HTMLSelectElement>('select');
	assert.ok(picker);
	assert.equal(picker.options.length, 768);
	await act(async () => {
		picker.value = '767';
		picker.dispatchEvent(new window.Event('change', { bubbles: true }));
	});
	const start = document.querySelector<HTMLInputElement>('input[name="start"]');
	const destination = document.querySelector<HTMLSelectElement>('select[name="track"]');
	assert.ok(start && destination);
	assert.equal(start.value, String(767 * 128));
	start.value = '100000';
	destination.value = 'destination';
	await render(true);
	await render(false, 'Retry the move');
	assert.equal(picker.value, '767');
	assert.equal(start.value, '100000');
	assert.equal(destination.value, 'destination');
	assert.equal(picker.options[767]?.textContent, 'Clip 767 (98176–98240)');
	assert.equal(document.querySelector('[role="alert"]')?.textContent, 'Retry the move');
	const form = document.querySelector('form');
	assert.ok(form);
	await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
	assert.deepEqual(commands, [{ kind: 'moveClip', clipId: '767', trackId: 'destination', start: 100000 }]);
	assert.equal(clipLabelsRead, 768);
	assert.equal(trackLabelsRead, 2);
});

void test('a sandboxed clip dialog applies by button and Enter without native form submission', async (context) => {
	const { window, document, root } = await mountEditor(context, true);
	const clips = [{ id: 'clip', name: 'Voice', start: 0, end: 1024, sourceOffset: 0 }];
	const tracks = [{ id: 'track', name: 'Talk', clipCount: 1 }];
	const commands: TracktionClipCommand[] = [];
	const onApply = (command: TracktionClipCommand) => { commands.push(command); };
	const render = (busy: boolean) => act(async () => root.render(<TracktionClipEditDialog kind="trim" clips={clips}
		tracks={tracks} sourceTrackId="track" busy={busy} failure="" onApply={onApply} onDismiss={() => undefined} />));
	await render(false);
	const form = document.querySelector('form');
	const target = form?.querySelector('button[type="submit"]');
	const start = form?.querySelector<HTMLInputElement>('input[name="start"]');
	assert.ok(form && target instanceof window.HTMLButtonElement && start);
	let nativeSubmissions = 0;
	form.addEventListener('submit', (event) => {
		nativeSubmissions += 1;
		event.preventDefault();
		event.stopPropagation();
	});
	start.value = '1024';
	await act(async () => { target.click(); });
	assert.deepEqual(commands, []);
	start.value = '64';
	const pressEnter = (isComposing: boolean) => start.dispatchEvent(new window.KeyboardEvent('keydown', {
		key: 'Enter', bubbles: true, cancelable: true, isComposing,
	}));
	await act(async () => { pressEnter(true); });
	assert.deepEqual(commands, []);
	await act(async () => { target.click(); pressEnter(false); });
	await render(true);
	await act(async () => { target.click(); pressEnter(false); });
	const expected = { kind: 'trim', clipId: 'clip', start: 64, end: 1024 };
	assert.deepEqual(commands, [expected, expected]);
	assert.equal(nativeSubmissions, 0);
});
