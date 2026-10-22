/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	waitForPackagedRuntimeProductPage,
} from './browser/helpers/packaged-runtime-coverage.js';

test('packaged coverage discovers its product only after the initial save releases beforeunload', async () => {
	let releaseReadiness!: () => void;
	const readiness = new Promise<void>((resolve) => { releaseReadiness = () => resolve(); });
	let readinessTimeout = 0;
	const page = {
		url: () => 'soundscaper-app://bundle/',
		async waitForFunction(predicate: () => boolean, _argument: undefined, options: { timeout: number }) {
			readinessTimeout = options.timeout;
			const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
			const previousDispatch = Object.getOwnPropertyDescriptor(globalThis, 'dispatchEvent');
			let blockUnload = false;
			try {
				Object.defineProperty(globalThis, 'document', {
					configurable: true,
					value: reloadReadinessDocument('true', 'false', 'saved'),
				});
				assert.equal(predicate(), false, 'an unready editor must not be reloaded');
				Object.defineProperty(globalThis, 'document', {
					configurable: true,
					value: reloadReadinessDocument('true', 'true', 'saving'),
				});
				assert.equal(predicate(), false, 'a pending save must not be reloaded');
				Object.defineProperty(globalThis, 'document', {
					configurable: true,
					value: reloadReadinessDocument('true', 'true', 'saved'),
				});
				Object.defineProperty(globalThis, 'dispatchEvent', {
					configurable: true,
					value: (event: Event) => {
						if (blockUnload) event.preventDefault();
						return !event.defaultPrevented;
					},
				});
				blockUnload = true;
				assert.equal(predicate(), false, 'the save UI may settle before its unload guard');
				blockUnload = false;
				assert.equal(predicate(), true, 'a completed save may be reloaded');
			} finally {
				if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
				else Reflect.deleteProperty(globalThis, 'document');
				if (previousDispatch) Object.defineProperty(globalThis, 'dispatchEvent', previousDispatch);
				else Reflect.deleteProperty(globalThis, 'dispatchEvent');
			}
			await readiness;
		},
	};
	const context = { pages: () => [page] };

	let discovered = false;
	const discovery = waitForPackagedRuntimeProductPage(
		context,
		'soundscaper-app://bundle',
		12_345,
	).then((result: unknown) => { discovered = true; return result; });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(discovered, false);
	assert.ok(readinessTimeout > 0 && readinessTimeout <= 12_345);
	releaseReadiness();
	assert.equal(await discovery, page);
});

function reloadReadinessDocument(bound: string, editorReady: string, saveState: string) {
	return {
		querySelector(selector: string) {
			assert.equal(selector, '[data-audio-editor]');
			return {
				getAttribute: (attribute: string) => {
					if (attribute === 'data-audio-editor-bound') return bound;
					assert.equal(attribute, 'data-editor-ready');
					return editorReady;
				},
				querySelector: (childSelector: string) => {
					assert.equal(childSelector, '[data-save-state]');
					return { getAttribute: () => saveState };
				},
			};
		},
	};
}
