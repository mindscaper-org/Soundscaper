/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';

test('opening another project retires a Nyquist plug-in source read before it can generate audio', async ({ page }) => {
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(
		createSoundscaperProject({ id: 'nyquist-source-incoming', title: 'Incoming source read' }), {
			async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
			readSourceChunks() { return (async function* empty() {})(); },
		});
	const incoming = Buffer.from(await archive.blob.arrayBuffer()).toString('base64');
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'launchQueue', { configurable: true,
			value: { setConsumer(consumer) { globalThis.__nextNyquistLaunch = consumer; } } });
	});
	let sourceStarted;
	const started = new Promise(resolve => { sourceStarted = resolve; });
	let releaseSource;
	const held = new Promise(resolve => { releaseSource = resolve; });
	await page.route('**/rissetdrum-*.ny', async route => {
		const response = await route.fetch();
		sourceStarted();
		await held;
		await route.fulfill({ response }).catch(() => undefined);
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Risset Drum']);
	const dialog = page.getByRole('dialog', { name: 'Risset Drum', exact: true });
	try {
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await started;
		await page.evaluate(base64 => {
			const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
			globalThis.__nextNyquistLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([bytes], 'incoming.sscape')) }] });
		}, incoming);
		await expect(editor).toHaveAttribute('data-project-id', 'nyquist-source-incoming');
		await waitForProjectActivation(editor);
		await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
		releaseSource();
		await expect(editor.locator('[data-clip-id][role="group"]')).toHaveCount(0);
		// A fresh explicit application is still usable in the new project.
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(editor.locator('[data-clip-id][role="group"]')).toHaveCount(1);
		await expect(editor).toHaveAttribute('data-project-id', 'nyquist-source-incoming');
	} finally { releaseSource(); }
});
