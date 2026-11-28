/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import type {
	TracktionOpenedProject, TracktionProjectBridge, TracktionProjectCommand, TracktionProjectReply,
} from '../src/soundscaper/tracktion-project-contract.ts';
import { TracktionEditor } from '../src/soundscaper/ui/TracktionEditor.tsx';

async function mountEditor(context: TestContext, embedded: boolean) {
	const { window: host } = new JSDOM('<body><iframe></iframe></body>');
	const window = embedded ? host.document.querySelector('iframe')?.contentWindow : host;
	assert.ok(window);
	const { document } = window;
	const dialogPrototype: object = Object.getPrototypeOf(document.createElement('dialog')) as object;
	Object.defineProperties(dialogPrototype, {
		showModal: { value(this: HTMLDialogElement) { this.open = true; } },
		close: { value(this: HTMLDialogElement) { this.open = false; } },
	});
	const nativeConfirmations: string[] = [];
	let allowNative = false;
	window.confirm = (message?: string) => { nativeConfirmations.push(message ?? ''); return allowNative; };
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ React, window, document, FormData: host.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, value });
	}
	const root = createRoot(document.body);
	context.after(async () => {
		await act(async () => root.unmount());
		host.close();
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	});

	const requests: string[] = [];
	let lost: Parameters<NonNullable<TracktionProjectBridge['onProjectLost']>>[0] | undefined;
	let sequence = 0;
	function opened(): TracktionOpenedProject {
		sequence += 1;
		return { sessionId: `session-${sequence}`, name: `Project ${sequence}`, initiallyUnsaved: true,
			project: { revision: 7, sampleRate: 48_000, canUndo: false, canRedo: false, nextOffset: null,
				tracks: [{ id: '1', name: 'Voice', clipCount: 1 }] },
			transport: { frame: 0, playing: false, recording: false } };
	}
	const bridge: TracktionProjectBridge = {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			requests.push(command.kind);
			if (command.kind === 'copyRange') return { revision: 7, itemId: null } as TracktionProjectReply<Command>;
			const value = command.kind === 'create' || command.kind === 'open' ? opened() : command.kind === 'close' ? null
				: { revision: 7, nextOffset: null, clips: [{ id: '2', name: 'Original take', start: 0, end: 1024, sourceOffset: 0 }] };
			return value as TracktionProjectReply<Command>;
		},
		async openArchive() { requests.push('archive'); return opened(); },
		onProjectLost(listener) { lost = listener; return () => { lost = undefined; }; },
	};
	await act(async () => root.render(<TracktionEditor bridge={bridge} />));
	function button(label: string) {
		const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === label);
		assert.ok(element, label);
		return element;
	}
	async function click(label: string) { await act(async () => { button(label).click(); }); }
	await click('New project');
	requests.length = 0;
	return { document, requests, button, click, nativeConfirmations, allowNative: () => { allowNative = true; },
		async loseProject(clipboardRetained?: boolean) {
			await act(async () => { lost?.(`session-${sequence}`, 'The project worker stopped', clipboardRetained); });
		} };
}

for (const [label, command] of [
	['Close project', 'close'], ['New project', 'create'], ['Open projects', 'open'], ['Open project archive (ZIP)', 'archive'],
]) test(`embedded ${label} waits before discarding and preserves the current edit on Cancel`, async (context) => {
	const { document, requests, click, nativeConfirmations } = await mountEditor(context, true);
	await click(label);
	assert.ok(document.querySelector('dialog[open]'));
	assert.deepEqual(requests, []);
	assert.deepEqual(nativeConfirmations, []);
	await click('Cancel');
	assert.equal(document.querySelector('dialog'), null);
	assert.equal(document.querySelector('h1')?.textContent, 'Project 1');
	assert.equal(document.querySelector('li')?.textContent, 'Original take (0–1024)');
	assert.deepEqual(requests, []);
	await click(label);
	await click(label === 'Close project' ? 'New project' : 'Close project');
	await click('Discard changes');
	assert.equal(document.querySelector('dialog'), null);
	assert.equal(requests[0], command);
	assert.equal(document.querySelector('h1')?.textContent, command === 'close' ? 'Soundscaper Tracktion' : 'Project 2');
});

test('an embedded discard closes with its lost project and cannot act on the next project', async (context) => {
	const { document, requests, click, loseProject } = await mountEditor(context, true);
	await click('Close project');
	const stale = document.querySelector<HTMLButtonElement>('dialog button:last-of-type');
	assert.ok(stale);
	await loseProject();
	assert.equal(document.querySelector('dialog'), null);
	await click('New project');
	await act(async () => { stale.click(); });
	assert.deepEqual(requests, ['create', 'clips']);
	assert.equal(document.querySelector('h1')?.textContent, 'Project 2');
});

test('top-level project replacements keep the synchronous browser confirmation', async (context) => {
	const { document, requests, click, nativeConfirmations, allowNative } = await mountEditor(context, false);
	await click('Open projects');
	assert.equal(nativeConfirmations.length, 1);
	assert.equal(document.querySelector('dialog'), null);
	assert.deepEqual(requests, []);
	allowNative();
	await click('Open projects');
	assert.equal(nativeConfirmations.length, 2);
	assert.deepEqual(requests, ['open', 'clips']);
});

for (const retained of [true, undefined]) {
	test(`Reopening after Tracktion engine loss reflects the ${retained ? 'retained' : 'lost'} clipboard`, async (context) => {
		const { document, requests, button, click, loseProject, allowNative } = await mountEditor(context, false);
		await click('Copy');
		const start = document.querySelector<HTMLInputElement>('dialog input[name="start"]');
		const end = document.querySelector<HTMLInputElement>('dialog input[name="end"]');
		assert.ok(start && end);
		start.value = '0';
		end.value = '1024';
		await click('Apply');
		assert.deepEqual(requests, ['copyRange']);
		assert.equal(button('Paste').disabled, false);

		allowNative();
		await click('Close project');
		assert.equal(button('Paste').disabled, true);
		await click('Open projects');
		assert.equal(button('Paste').disabled, false);
		await loseProject(retained);
		assert.equal(document.querySelector('h1')?.textContent, 'Soundscaper Tracktion');
		await click('Open projects');
		assert.equal(button('Paste').disabled, !retained);
	});
}
