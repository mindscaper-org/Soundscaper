/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, collectClientErrors } from './audio-editor-test-helpers.js';

for (const [name, mimeType, body] of [
	['Session.text', 'text/plain', '0\t0.1\tOpening dialogue\n'],
	['Session.sub', 'application/x-subrip', '1\n00:00:00,000 --> 00:00:00,100\nOpening dialogue\n'],
	['Session.captions', 'text/vtt', 'WEBVTT\n\n00:00.000 --> 00:00.100\nOpening dialogue\n'],
]) test(`a ${mimeType} sidecar with a nonstandard suffix reaches the maintained label importer`, async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseFileAction(page, editor, 'Import');
	await editor.locator('[data-import-input]').setInputFiles({ name, mimeType, buffer: Buffer.from(body) });
	const label = editor.locator('[data-label-id]');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Opening dialogue');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(label).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Opening dialogue');
	expect(errors).toEqual([]);
});

test('a known audio suffix keeps its route when the operating system reports a text MIME', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseFileAction(page, editor, 'Import');
	await editor.locator('[data-import-input]').setInputFiles({ ...createWavFixture({ name: 'Recording.wav', duration: .1 }), mimeType: 'text/plain' });
	await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
	await expect(editor.locator('[data-label-id]')).toHaveCount(0);
	expect(errors).toEqual([]);
});
