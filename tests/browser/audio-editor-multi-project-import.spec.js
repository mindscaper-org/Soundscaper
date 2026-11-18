/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';

async function archiveFile(id, title) {
	const exported = await createSoundscaperScapeNativeRuntime().exportScapeProject(createSoundscaperProject({ id, title }), {
		async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
		async *readSourceChunks() {},
	});
	return { name: `${id}.sscape`, mimeType: 'application/zip', buffer: Buffer.from(await exported.blob.arrayBuffer()) };
}

test('the Import picker opens healthy projects on both sides of a damaged archive', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const first = await archiveFile('batch-first', 'First batch edit');
	const last = await archiveFile('batch-last', 'Last batch edit');
	await importFiles(editor, [first,
		{ name: 'broken.sscape', mimeType: 'application/zip', buffer: Buffer.from('This is not a Scape archive.') },
		last]);
	await expect(editor.getByRole('tab', { name: 'First batch edit', exact: true })).toBeVisible();
	await expect(editor.getByRole('tab', { name: 'Last batch edit', exact: true })).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-project-id', 'batch-last');
});

test('cancelling a project conflict ends that OS launch batch', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'launchQueue', { configurable: true,
			value: { setConsumer(consumer) { globalThis.acceptTestLaunch = consumer; } } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	const first = await archiveFile('batch-conflict', 'Local edit');
	await importFiles(editor, [first]);
	await expect(editor).toHaveAttribute('data-project-id', 'batch-conflict');
	await waitForProjectActivation(editor);
	const conflict = await archiveFile('batch-conflict', 'Conflicting edit');
	const later = await archiveFile('batch-cancel-later', 'Unopened batch edit');
	const nextLaunch = await archiveFile('batch-next-launch', 'Next launch edit');
	await page.evaluate(batches => {
		for (const batch of batches) {
			globalThis.acceptTestLaunch({ files: batch.map(({ name, mimeType, bytes }) => ({
				kind: 'file', getFile: () => Promise.resolve(new File([Uint8Array.from(bytes)], name, { type: mimeType })),
			})) });
		}
	}, [[conflict, later], [nextLaunch]].map(batch => batch.map(({ name, mimeType, buffer }) => ({ name, mimeType, bytes: [...buffer] }))));
	const dialog = page.locator('[data-scape-open-decision="collision"]');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(editor.getByRole('tab', { name: 'Next launch edit', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect(editor.getByRole('tab', { name: 'Local edit', exact: true })).toBeVisible();
	await expect(editor.getByRole('tab', { name: 'Unopened batch edit', exact: true })).toHaveCount(0);
});
