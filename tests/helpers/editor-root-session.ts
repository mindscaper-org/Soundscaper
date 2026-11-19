/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { Root } from 'react-dom/client';

import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { createEditorRootDom, type EditorRootDom } from './editor-root-dom.ts';

type Product = 'soundscaper' | 'framescaper';
type ProductSession = Awaited<ReturnType<typeof createProductSession>>;

async function createProductSession(product: Product, indexedDB: ReturnType<typeof createInstrumentedIndexedDB>) {
	const { ENGLISH_COPY } = await import('../../src/common/i18n/catalogs.js');
	const { createAudioEditorFileService } = await import('../../src/common/editor/file-service.js');
	const fileService = createAudioEditorFileService();
	const presentation = { locale: 'en', copy: ENGLISH_COPY, fileService };
	const options = { storeOptions: { indexedDB, preferOpfs: false } };
	if (product === 'soundscaper') {
		const { createSoundscaperEditorProjectEnvironment } = await import('../../src/soundscaper/editor-project-environment.ts');
		const { createSoundscaperAudioEditorController } = await import('../../src/soundscaper/editor-controller.ts');
		const environment = await createSoundscaperEditorProjectEnvironment(options);
		try {
			return { environment, controller: createSoundscaperAudioEditorController(environment, presentation), fileService, copy: ENGLISH_COPY };
		} catch (error) { await environment.close(); throw error; }
	}
	const { createFramescaperEditorProjectEnvironment } = await import('../../src/framescaper/editor-project-environment.ts');
	const { createFramescaperAudioEditorController } = await import('../../src/framescaper/editor-controller.ts');
	const environment = await createFramescaperEditorProjectEnvironment(options);
	try {
		return { environment, controller: createFramescaperAudioEditorController(environment, presentation), fileService, copy: ENGLISH_COPY };
	} catch (error) { await environment.close(); throw error; }
}

/** Product storage code is real; its underlying IndexedDB host is an emulator. */
export async function createEditorRootSession(context: TestContext, product: Product = 'soundscaper') {
	const dom = await createEditorRootDom(context);
	const indexedDB = createInstrumentedIndexedDB();
	const { createRoot } = await import('react-dom/client');
	const { BoundAudioEditorApp } = await import('../../src/common/editor/ui/AudioEditorApp.jsx');
	const open = async () => {
		const session: ProductSession = await createProductSession(product, indexedDB);
		let root: Root | undefined;
		let disposal: Promise<void> | undefined;
		const container = dom.document.createElement('div');
		dom.document.body.append(container);
		const retire = (): Promise<void> => disposal ??= (async () => {
			const failures: unknown[] = [];
			if (root) {
				try { await dom.react.act(async () => { root?.unmount(); }); } catch (error) { failures.push(error); }
				root = undefined;
			}
			try { await session.controller.dispose(); } catch (error) { failures.push(error); }
			try { await session.environment.close(); } catch (error) { failures.push(error); }
			container.remove();
			if (failures.length) throw new AggregateError(failures, 'Product editor teardown failed.');
		})();
		dom.onDispose(retire);
		try {
			await session.controller.ready;
			root = createRoot(container);
			await dom.react.act(async () => {
				root?.render(dom.react.createElement(BoundAudioEditorApp, {
					controller: session.controller, fileService: session.fileService,
					copy: session.copy, locale: 'en', productId: product,
					projectForRuntimeConsumers: session.environment.runtime.projectForRuntimeConsumers,
				}));
			});
			await dom.wait(() => !!container.querySelector('[data-audio-editor-bound="true"][data-editor-ready="true"]'),
				'the actual product editor root becomes ready');
			dom.assertHealthy();
		} catch (error) { await retire(); throw error; }
		return { ...session, container, retire };
	};
	let current = await open();
	return {
		dom,
		get controller() { return current.controller; },
		get environment() { return current.environment; },
		get container() { return current.container; },
		async reopen() { await current.retire(); current = await open(); return current; },
		async storedPreferences(): Promise<unknown> {
			return current.environment.store.loadSetting(`${product}:audio-editor-preferences-v1`);
		},
		async preferences() { return openPreferences(dom); },
	};
}

export async function openPreferences(dom: EditorRootDom): Promise<HTMLElement> {
	await dom.click(dom.byText('[data-application-menubar] [role="menuitem"]', 'Edit'));
	await dom.wait(() => !!dom.document.querySelector('.kw-audio-editor__application-menu'), 'the actual Edit menu opens');
	const menu = dom.element('.kw-audio-editor__application-menu');
	await dom.click(dom.byText('[role="menuitem"]', /^Preferences/u, menu));
	await dom.wait(() => !!dom.document.querySelector('[role="dialog"][aria-label="Editor preferences"]'), 'the actual menu opens Preferences');
	dom.assertHealthy();
	return dom.element('[role="dialog"][aria-label="Editor preferences"]');
}

export async function closePreferences(dom: EditorRootDom, dialog: HTMLElement): Promise<void> {
	const buttons = [...dialog.querySelectorAll('button')].filter(node => node.textContent?.trim() === 'Close');
	const button = buttons.at(-1);
	assert.ok(button);
	await dom.click(button);
	await dom.wait(() => !dialog.isConnected, 'the actual Preferences dialog closes');
}

export async function choosePreference(dom: EditorRootDom, group: HTMLElement, choice: string): Promise<void> {
	const requestsBefore = dom.scrollRequests.length;
	await dom.click(dom.element('button', group));
	await dom.wait(() => [...dom.document.querySelectorAll('[role="option"]')]
		.some(node => node.textContent?.trim() === choice), `the actual dropdown offers ${choice}`);
	await dom.click(dom.byText('[role="option"]', choice));
	const requests = dom.scrollRequests.slice(requestsBefore);
	assert.ok(requests.length > 0, 'the shipping dropdown requested its active option scroll');
	for (const request of requests) {
		assert.equal(request.element.getAttribute('role'), 'option');
		assert.deepEqual(request.options, { block: 'nearest' });
	}
	dom.assertHealthy();
}

export function labeledInput(dom: EditorRootDom, label: string, root: ParentNode): HTMLInputElement {
	const input = [...root.querySelectorAll('input')].find(node => node.getAttribute('aria-label') === label
		|| [...node.labels ?? []].some(item => item.textContent?.trim() === label));
	assert.ok(input instanceof dom.window.HTMLInputElement, `Missing actual labeled input: ${label}`);
	return input;
}
