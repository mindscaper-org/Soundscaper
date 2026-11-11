import { createWavFixture, expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseExportProjectFileAction,
	chooseDropdown,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
	readDownloadBytes,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('audio editor task progress', () => {
	registerAudioEditorHooks();

	test('announces blocking work in a dialog and removes it after completion', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await editor.evaluate((root) => {
			globalThis.__taskProgressEvents = [];
			new MutationObserver(() => {
				const progress = root.querySelector('[data-editor-task-progress]');
				if (!progress) return;
				const bar = progress.querySelector('[role="progressbar"]');
				globalThis.__taskProgressEvents.push({
					modal: Boolean(progress.closest('[role="dialog"][aria-modal="true"]')),
					kind: progress.getAttribute('data-editor-task-progress'),
					indeterminate: progress.hasAttribute('data-indeterminate'),
					role: bar?.getAttribute('role'),
					value: bar?.getAttribute('aria-valuenow'),
				});
			}).observe(root, { attributes: true, childList: true, subtree: true });
		});

		await editor.locator('[data-import-input]').setInputFiles([longTone]);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		const events = await page.evaluate(() => globalThis.__taskProgressEvents);
		expect(events.some((event) => (
			event.kind === 'import'
			&& event.modal
			&& event.indeterminate
			&& event.role === 'progressbar'
			&& event.value === null
		))).toBe(true);
		await expect(editor.locator('[data-editor-task-progress]')).toHaveCount(0);
		await expect(editor.locator('[data-task-progress-dialog]')).toHaveCount(0);
	});

	test('keeps a non-blocking project save in a toast while the status bar is hidden', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: async () => {
				await new Promise((resolve) => { globalThis.__releaseProgressSavePicker = resolve; });
				throw new DOMException('Cancelled', 'AbortError');
			} });
		});
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'View', 'Status bar');
		await chooseExportProjectFileAction(page, editor);
		const toast = editor.getByRole('region', { name: 'Saving project', exact: true });
		await expect(toast).toBeVisible();
		await expect(toast.getByRole('progressbar')).toBeVisible();
		await expect(toast.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
		await expect(editor.getByRole('dialog')).toHaveCount(0);
		await expect(toast.getByRole('button')).toHaveCount(0);
		// The editor remains interactive while the save owns its progress toast.
		await chooseCommandAction(page, editor, 'View', 'Status bar');
		await expect(toast).toBeVisible();
		await expect(editor.locator('[data-selection-toolbar]').getByRole('progressbar')).toHaveCount(0);
		await page.evaluate(() => { globalThis.__releaseProgressSavePicker(); });
		await expect(toast).toHaveCount(0);
	});

	test('streams MP3 past the old frame ceiling and reports encoding progress with the status bar hidden', async ({ page }) => {
		test.setTimeout(330_000);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		const audio = createWavFixture({ name: 'three-minute-audio.wav', frequency: 220, duration: 180, channelCount: 1 });
		await importFiles(editor, [audio], { timeout: 60_000 });
		await chooseCommandAction(page, editor, 'View', 'Status bar');
		await editor.evaluate((root) => {
			globalThis.__encodingProgress = [];
			new MutationObserver(() => {
				const progress = root.querySelector('[data-editor-task-progress="export"]');
				const bar = progress?.querySelector('[role="progressbar"]');
				if (bar) globalThis.__encodingProgress.push({
					label: bar.getAttribute('aria-label'),
					value: Number(bar.getAttribute('aria-valuenow')),
					visible: progress.getBoundingClientRect().height > 0,
					modal: Boolean(progress.closest('[role="dialog"][aria-modal="true"]')),
				});
			}).observe(root, { attributes: true, childList: true, subtree: true });
		});
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
		await chooseDropdown(page, dialog.locator('[data-export-field="bitRateMode"]'), 'Constant');
		await chooseDropdown(page, dialog.locator('[data-export-field="quality"]'), '192 kbps');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = dialog.locator('[data-export-download]');
		const failure = dialog.locator('.audio-editor-field-error');
		const workspaceErrors = page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]');
		await expect.poll(async () => await download.isVisible() || await workspaceErrors.count() > 0, { timeout: 270_000 }).toBe(true);
		await expect(workspaceErrors).toHaveCount(0);
		expect(await failure.allTextContents()).toEqual([]);
		const bytes = await readDownloadBytes(page, download);
		expect(bytes.length).toBeGreaterThan(1_000_000);
		const progress = await page.evaluate(() => globalThis.__encodingProgress);
		expect(progress.some((event) => event.visible && event.modal && /encoding/iu.test(event.label) && event.value > 70 && event.value < 95)).toBe(true);
		await expect(editor.locator('[data-editor-task-progress]')).toHaveCount(0);
	});

	test('contains focus in the blocking dialog and cancels an import for another import', async ({ page }) => {
		await page.addInitScript(() => {
			globalThis.__slowImportReads = true;
			const read = Blob.prototype.arrayBuffer;
			Blob.prototype.arrayBuffer = async function () {
				if (globalThis.__slowImportReads && this.size > 4096) await new Promise((resolve) => setTimeout(resolve, 1000));
				return read.call(this);
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'View', 'Status bar');
		await editor.locator('[data-import-input]').setInputFiles([longTone]);
		const dialog = editor.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('aria-modal', 'true');
		const progress = dialog.locator('[data-editor-task-progress="import"]');
		await expect(progress).toBeVisible();
		await expect(progress.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
		await expect(dialog).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(progress.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(dialog.getByRole('button', { name: /^Resize:/u })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(progress.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeVisible();
		await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(progress).toHaveCount(0, { timeout: 10_000 });
		await expect(dialog).toHaveCount(0);
		await page.evaluate(() => { globalThis.__slowImportReads = false; });
		await importFiles(editor, [longTone]);
		await expect(editor.locator('[data-editor-task-progress]')).toHaveCount(0);
	});
});
