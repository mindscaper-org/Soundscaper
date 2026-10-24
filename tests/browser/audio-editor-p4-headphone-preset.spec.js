/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, closeWorkspacePanel, disableNativeSavePicker, downloadBytes,
	importFiles, openExportDialog, readDownloadBytes, waitForEditor, waitForProjectActivation,
} from './audio-editor-test-helpers.js';

async function saveAs(page, dialog, name) {
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await naming.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
	await naming.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(naming).toBeHidden();
	await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText(name);
}

for (const mode of ['ordinary', 'headphones', 'headphones-file']) test(`delivery preset restores ${mode} rendering after a fresh reload`, async ({ page }, testInfo) => {
	test.setTimeout(90_000);
	const headphones = mode !== 'ordinary', fromFile = mode === 'headphones-file';
	const name = headphones ? 'Headphone delivery' : 'Mono delivery';
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await closeWorkspacePanel(editor, 'metadata');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	let dialog = await openExportDialog(page, editor);
	await dialog.locator('[data-export-channel-option="mono"] input').check();
	if (headphones) await dialog.getByRole('checkbox', { name: 'Render for headphones', exact: true }).check();
	await saveAs(page, dialog, name);
	await dialog.getByRole('button', { name: 'More options', exact: true }).click();
	const downloading = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: 'Export preset', exact: true }).click();
	const file = Buffer.from(await downloadBytes(await downloading));
	await testInfo.attach('saved-delivery-preset.json', { body: file, contentType: 'application/json' });
	await page.reload(); await waitForEditor(page); await waitForProjectActivation(editor);
	dialog = await openExportDialog(page, editor);
	await expect(dialog.getByRole('checkbox', { name: 'Render for headphones', exact: true })).not.toBeChecked();
	if (fromFile) {
		await dialog.getByRole('button', { name: 'Preset', exact: true }).click();
		await page.getByRole('option', { name: new RegExp(`^${name} \\(custom\\)`, 'u') }).click();
		await dialog.getByRole('button', { name: 'Delete preset', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText('No preset');
		await dialog.getByRole('checkbox', { name: 'Render for headphones', exact: true }).uncheck();
		await dialog.getByRole('button', { name: 'More options', exact: true }).click();
		const choosing = page.waitForEvent('filechooser');
		await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
		await (await choosing).setFiles({ name: 'headphones.json', mimeType: 'application/json', buffer: file });
		await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toBeEnabled();
	}
	await dialog.getByRole('button', { name: 'Preset', exact: true }).click();
	await page.getByRole('option', { name: new RegExp(`^${name} \\(custom\\)`, 'u') }).click();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	const audio = await page.evaluate(async bytes => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer);
			return { channels: buffer.numberOfChannels, frames: buffer.length,
				peak: Math.max(...buffer.getChannelData(0)) };
		} finally { await context.close(); }
	}, Array.from(await readDownloadBytes(page, link)));
	await testInfo.attach('actual-delivery.json', { body: JSON.stringify(audio), contentType: 'application/json' });
	expect(audio.channels).toBe(headphones ? 2 : 1);
	expect(audio.frames).toBe(38_400); expect(audio.peak).toBeGreaterThan(.05);
	await expect(dialog.getByRole('checkbox', { name: 'Render for headphones', exact: true })).toBeChecked({ checked: headphones });
	const saved = JSON.parse(file.toString('utf8'));
	expect(saved.presets[0].settings.binaural === true).toBe(headphones);
});
