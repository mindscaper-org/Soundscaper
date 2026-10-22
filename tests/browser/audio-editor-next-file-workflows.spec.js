/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';

test('an oversized remote Freesound upload history remains visible and removable', async ({ page }) => {
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		const data = path.endsWith('/oauth/session')
			? { connected: true, user: { username: 'field-recorder' } }
			: path.endsWith('/uploads/pending')
				? { pendingDescription: Array.from({ length: 101 }, (_, index) => `remote-${index}.wav`), pendingProcessing: [], pendingModeration: [] }
				: { status: 'pending_moderation', soundId: 42 };
		await route.fulfill({ json: { data } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Freesound']);
	const uploads = editor.locator('[data-freesound-uploads="true"]');
	await uploads.getByText('Upload to Freesound', { exact: true }).click();
	await expect(uploads.locator('li')).toHaveCount(100);
	const first = uploads.locator('li').first();
	await first.getByRole('button', { name: /^Ready to publish/u }).click();
	const dialog = page.locator('[data-freesound-publish-dialog="true"]');
	await dialog.locator('textarea[name="description"]').fill('Forest ambience');
	await dialog.locator('input[name="tags"]').fill('forest ambience field');
	await dialog.locator('input[name="rightsConfirmed"]').check();
	await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await first.getByRole('button', { name: /^Remove/u }).click();
	await expect(uploads.locator('li')).toHaveCount(99);
});

test('an OS-opened project can start raw PCM import while an outgoing raw file read waits', async ({ page }) => {
	const runtime = createSoundscaperScapeNativeRuntime();
	const archive = await runtime.exportScapeProject(createSoundscaperProject({ id: 'raw-incoming', title: 'Incoming raw import' }), {
		async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
		readSourceChunks() { return (async function* empty() {})(); },
	});
	expect(archive.blob).toBeInstanceOf(Blob);
	const incoming = Buffer.from(await archive.blob.arrayBuffer()).toString('base64');
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'launchQueue', { configurable: true,
			value: { setConsumer(consumer) { globalThis.__nextRawLaunch = consumer; } } });
		const held = new WeakSet();
		const nativeSlice = File.prototype.slice;
		File.prototype.slice = function (...args) {
			const result = nativeSlice.apply(this, args);
			if (this.name === 'outgoing.raw') held.add(result);
			return result;
		};
		const nativeRead = Blob.prototype.arrayBuffer;
		Blob.prototype.arrayBuffer = function () {
			if (!held.has(this)) return nativeRead.call(this);
			globalThis.__nextRawReadPending = true;
			return new Promise(resolve => { globalThis.__nextRawReadRelease = () => { void nativeRead.call(this).then(resolve); }; });
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tools', ['Import raw data']);
	const dialog = page.locator('[data-import-surface="raw-pcm"]');
	await dialog.locator('input[type="file"]').setInputFiles({ name: 'outgoing.raw', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 0]) });
	await dialog.getByRole('button', { name: 'Import', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__nextRawReadPending)).toBe(true);
	await page.evaluate(base64 => {
		const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
		globalThis.__nextRawLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([bytes], 'incoming.sscape', { type: 'application/x-scape-project' })) }] });
	}, incoming);
	await expect(editor).toHaveAttribute('data-project-id', 'raw-incoming');
	await dialog.locator('input[type="file"]').setInputFiles({ name: 'incoming.raw', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 32, 0, 224]) });
	await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await page.evaluate(() => globalThis.__nextRawReadRelease());
	await expect(editor).toHaveAttribute('data-project-id', 'raw-incoming');
	await expect(editor.locator('[data-clip-id][role="group"]')).toHaveCount(1);
});
