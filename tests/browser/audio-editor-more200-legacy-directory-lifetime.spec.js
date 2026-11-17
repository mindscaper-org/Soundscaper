/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { legacyAupFiles } from '../helpers/more200-legacy-aup-file.ts';

async function completeDirectoryChooser(chooser, dataFile) {
	await chooser.element().evaluate((input, fixture) => {
		if (!input.isConnected || input.type !== 'file' || !input.webkitdirectory) {
			throw new Error('Legacy directory chooser is no longer connected to its workspace input');
		}
		const binary = atob(fixture.base64);
		const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
		const file = new File([bytes], fixture.name, { type: fixture.type });
		Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: 'Legacy_data/e0000.au' });
		const transfer = new DataTransfer();
		transfer.items.add(file);
		input.files = transfer.files;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}, {
		name: dataFile.name,
		type: dataFile.type,
		base64: Buffer.from(await dataFile.arrayBuffer()).toString('base64'),
	});
}

for (const handoff of [false, true]) test(`legacy directory completion preserves the selected activation, OS handoff=${String(handoff)}`, async ({ page }) => {
	// Two document imports and an intervening OS handoff each perform activation.
	test.setTimeout(60_000);
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(createSoundscaperProject({ id: 'directory-incoming', title: 'Incoming document' }), {
		async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
		readSourceChunks() { return (async function* empty() {})(); },
	});
	expect(archive.blob).toBeInstanceOf(Blob); const incoming = Buffer.from(await archive.blob.arrayBuffer()).toString('base64');
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'launchQueue', { configurable: true,
			value: { setConsumer(consumer) { globalThis.__legacyDirectoryLaunch = consumer; } } });
	});
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: projectFile.name, mimeType: projectFile.type, buffer: Buffer.from(await projectFile.arrayBuffer()) });
	const staleDirectory = await choosing;
	if (handoff) await page.evaluate(base64 => {
		const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
		globalThis.__legacyDirectoryLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([bytes], 'Incoming.sscape', { type: 'application/x-scape-project' })) }] });
	}, incoming);
	if (handoff) { await expect(editor).toHaveAttribute('data-project-id', 'directory-incoming'); await waitForProjectActivation(editor); }
	await completeDirectoryChooser(staleDirectory, dataFile);
	if (!handoff) {
		await expect(editor.locator('.audio-editor-track-row').filter({ hasText: 'Voix 日本語 🎙' })).toBeVisible();
		await expect(editor.locator('[data-status]')).toContainText('Imported the legacy AUP tracks, clips, and labels.');
	} else {
		await expect(editor).toHaveAttribute('data-project-id', 'directory-incoming');
		await expect(editor).toHaveAttribute('data-clip-count', '0');
	}
	await waitForProjectActivation(editor);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason');
	const choosingFresh = page.waitForEvent('filechooser');
	const fresh = (await projectFile.text()).replaceAll('Été 演奏 🎙', 'Fresh').replaceAll('Voix 日本語 🎙', 'Fresh voice');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Fresh.aup', mimeType: projectFile.type, buffer: Buffer.from(fresh) });
	await completeDirectoryChooser(await choosingFresh, dataFile);
	await expect(editor.locator('.audio-editor-track-row').filter({ hasText: 'Fresh voice' })).toBeVisible();
	await expect(editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab')).toHaveCount(3);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
