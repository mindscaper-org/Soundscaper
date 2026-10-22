import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, registerAudioEditorHooks, waitForEditor } from './audio-editor-test-helpers.js';

test.describe('read-only folder inspection', () => {
	registerAudioEditorHooks();
	test('a read-only tab can inspect collapsed descendants without saving the presentation choice', async ({ page, context }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-track-row]').first().getByRole('button', { name: 'Track menu', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Move selection into new folder', exact: true }).click();
		const folder = editor.locator('[data-track-folder-row]');
		await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
		await expect(editor.locator('[data-track-row]')).toHaveCount(0);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const other = await context.newPage();
		await other.goto('/embed/en/');
		const otherEditor = await waitForEditor(other);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await expect(folder.getByRole('button', { name: 'Mute folder', exact: true })).toBeDisabled();
		await folder.getByRole('button', { name: 'Expand folder', exact: true }).click();
		await expect(editor.locator('[data-track-row]')).toHaveCount(1);
		await expect(otherEditor.locator('[data-track-folder-row]')).toHaveAttribute('aria-expanded', 'false');
		await folder.focus();
		await page.keyboard.press('ArrowLeft');
		await expect(editor.locator('[data-track-row]')).toHaveCount(0);
		await page.keyboard.press('ArrowRight');
		await expect(editor.locator('[data-track-row]')).toHaveCount(1);
		await other.reload();
		const restored = await waitForEditor(other);
		await expect(restored.locator('[data-track-folder-row]')).toHaveAttribute('aria-expanded', 'false');
		await other.close();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
		await expect(folder).toHaveAttribute('aria-expanded', 'false');
		expect(errors).toEqual([]);
	});
});
