/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('Framescaper becomes ready without loading native rendering, offline export or FFT execution', async ({ page }) => {
	const requested = [];
	page.on('request', request => { requested.push(new URL(request.url()).pathname); });
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await expect(editor).toHaveAttribute('data-product', 'framescaper');
	expect(requested.filter(path => /\/(?:editor-optional-(?:export|execution)|editor-pffft-runtime|editor-native-render-input-(?:producer|stream-producer))-[^/]+\.js$/u.test(path))).toEqual([]);
	expect(errors).toEqual([]);
});
