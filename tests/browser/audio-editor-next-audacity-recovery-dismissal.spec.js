/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createAup3Fixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('pending Audacity file recovery keeps its progress dialog until the import completes', async ({ page }) => {
	await page.addInitScript(() => {
		const NativeWorker = globalThis.Worker;
		const queued = [];
		globalThis.__recoveryReadQueued = false;
		globalThis.__releaseRecoveryRead = () => {
			for (const [worker, message, options] of queued.splice(0)) NativeWorker.prototype.postMessage.call(worker, message, ...options);
		};
		globalThis.Worker = class extends NativeWorker {
			constructor(url, options) { super(url, options); this.audacity = options?.name === 'kw-media-audacity-projects'; }
			postMessage(message, ...options) {
				if (this.audacity && message.type === 'open-file' && message.args.recover) {
					queued.push([this, message, options]); globalThis.__recoveryReadQueued = true; return;
				}
				super.postMessage(message, ...options);
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Recover Audacity project']);
	const dialog = page.getByRole('dialog', { name: 'Recover Audacity project', exact: true });
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(editor.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Recover Audacity project']);
	const bytes = await createAup3Fixture();
	await dialog.locator('input[type="file"]').setInputFiles({ name: 'Recover me.aup3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
	await dialog.getByRole('button', { name: 'Recover project file', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__recoveryReadQueued)).toBe(true);
	await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeDisabled();
	try {
		await page.keyboard.press('Escape');
		await expect(dialog).toBeVisible();
	} finally { await page.evaluate(() => globalThis.__releaseRecoveryRead()); }
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened');
});
