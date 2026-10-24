/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { opusPaddingAvFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

test('Cancel releases a real pending native video seek before fresh import', async ({ page, browserName }) => {
	test.skip(browserName !== 'firefox', 'This recording exposes a pending native seek in Firefox; other engines complete it before Cancel.');
	test.setTimeout(60_000); let started = false;
	await page.exposeBinding('__nativeVideoSeek', () => { started = true; });
	await page.addInitScript(() => {
		document.addEventListener('seeking', event => {
			if (event.target instanceof HTMLVideoElement) void globalThis.__nativeVideoSeek();
		}, true);
	});
	const editor = await bootEditor(page, '/embed/en/'); const file = opusPaddingAvFixture(32 * 1024 ** 2);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect.poll(() => started, { timeout: 25_000 }).toBe(true);
	const progress = editor.locator('[data-editor-task-progress="import"]');
	await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(progress).toHaveCount(0); await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await editor.locator('[data-import-input]').setInputFiles({ ...toneA, name: 'Fresh.wav' });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('group', { name: /^Fresh\.wav clip,/u })).toHaveCount(1);
	await expect(editor.getByRole('group', { name: /^Short audio padded/u })).toHaveCount(0);
	await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
});
