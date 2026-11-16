import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	closeWorkspacePanel,
	commitInput,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
	readDownloadBytes,
	waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test.describe('BW64 ADM metadata UI', () => {
	registerAudioEditorHooks();

	test('exports an opted-in EBU EAR speaker render through File Export', async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [monoTone]);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'ADM', exact: true }).click();
		await panel.getByRole('button', { name: 'Enable ADM', exact: true }).click();
		await panel.locator('select[name="adm-bed-layout"]').selectOption('mono');
		await closeWorkspacePanel(editor, 'metadata');
		const dialog = await openExportDialog(page, editor);
		const renderer = dialog.getByRole('group', { name: 'EBU EAR speaker rendering', exact: true });
		await expect(renderer).toBeVisible();
		await expect(renderer.getByRole('button')).toContainText('Off — preserve programme channels');
		await chooseDropdown(page, renderer, '5.1.4');
		await expect(dialog.locator('[data-export-channel-option="preserve"] input')).toBeDisabled();
		await dialog.getByRole('checkbox', { name: 'Render for headphones', exact: true }).check();
		await expect(renderer.getByRole('button')).toContainText('Off — preserve programme channels');
		await chooseDropdown(page, renderer, '5.1.4');
		await expect(dialog.getByRole('checkbox', { name: 'Render for headphones', exact: true })).not.toBeChecked();
		await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = dialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 30_000 });
		const bytes = await readDownloadBytes(page, download);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let channelCount = 0;
		let dataBytes = 0;
		let dataOffset = 0;
		for (let offset = 12; offset + 8 <= bytes.length;) {
			const name = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
			const length = view.getUint32(offset + 4, true);
			if (name === 'fmt ') channelCount = view.getUint16(offset + 10, true);
			if (name === 'data') { dataBytes = length; dataOffset = offset + 8; }
			offset += 8 + length + (length % 2);
		}
		expect(channelCount).toBe(10);
		expect(dataBytes).toBeGreaterThan(0);
		const energy = Array.from({ length: 10 }, () => 0);
		for (let offset = dataOffset; offset + 40 <= dataOffset + dataBytes; offset += 40) {
			for (let channel = 0; channel < 10; channel += 1) energy[channel] += view.getFloat32(offset + channel * 4, true) ** 2;
		}
		expect(energy[2]).toBeGreaterThan(0.01);
		expect(energy.filter((_value, index) => index !== 2).every((value) => value < 1e-8)).toBe(true);
	});

	test('BW64 enablement and authored DirectSpeakers drafts retain both metadata entrypoints', async ({ page }) => {
		const caseTimeout = test.info().timeout;
		test.setTimeout(caseTimeout * 2);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await test.step('disabled BW64 and Metadata dialog opt-in', async () => {
			await importFiles(editor, [monoTone]);
			const dialog = await openExportDialog(page, editor);
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');

			await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
			await expect(dialog.getByRole('alert')).toHaveText(
				'BW64 export requires ADM. Open Metadata, select ADM, and enable it.',
			);

			await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
			const metadataDialog = page.getByRole('dialog', { name: 'Metadata', exact: true });
			await metadataDialog.getByRole('tab', { name: 'ADM', exact: true }).click();
			await metadataDialog.getByRole('button', { name: 'Enable ADM', exact: true }).click();
			await metadataDialog.getByRole('button', { name: 'Done', exact: true }).click();

			await expect(dialog.getByRole('alert')).toHaveCount(0);
			await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
			await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(dialog).toBeHidden();
		}, { timeout: caseTimeout });
		await test.step('fresh project and workspace-authored DirectSpeakers bed', async () => {
			const previousId = await editor.getAttribute('data-project-id');
			await editor.getByRole('button', { name: 'New project', exact: true }).click();
			await expect(editor).not.toHaveAttribute('data-project-id', previousId);
			await waitForProjectActivation(editor);
			await expect(editor).toHaveAttribute('data-clip-count', '0');
			const projectId = await editor.getAttribute('data-project-id');
			await expect.poll(async () => (await persistedProject(page, projectId))?.sources.length).toBe(0);
			await expect.poll(async () => (await persistedProject(page, projectId))?.metadata.adm).toBeNull();
			await importFiles(editor, [monoTone]);
			await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
			let panel = editor.locator('[data-workspace-panel="metadata"]');
			await panel.getByRole('tab', { name: 'ADM', exact: true }).click();
			await panel.getByRole('button', { name: 'Enable ADM', exact: true }).click();
			await panel.locator('select[name="adm-bed-layout"]').selectOption('mono');
			await commitInput(panel.locator('input[name="adm-programme-name"]'), 'Evening programme');
			await expect(panel.locator('[data-adm-mode="authored"]')).toBeVisible();
			await expect(panel.locator('.audio-editor-adm-route select')).toHaveCount(3);
			for (const route of await panel.locator('.audio-editor-adm-route select').all()) await expect(route).toHaveValue('M');

			await closeWorkspacePanel(editor, 'metadata');
			await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
			panel = editor.locator('[data-workspace-panel="metadata"]');
			await panel.getByRole('tab', { name: 'ADM', exact: true }).click();
			await expect(panel.locator('input[name="adm-programme-name"]')).toHaveValue('Evening programme');
			await closeWorkspacePanel(editor, 'metadata');

			const dialog = await openExportDialog(page, editor);
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
			// A programme is one delivered file, so the split forms are not offered and
			// its authored channel order is the only mapping it can be written with.
			await dialog.locator('[data-export-field="output"]').getByRole('button').click();
			await expect(page.getByRole('option')).toHaveCount(1);
			await expect(page.getByRole('option', { name: 'Entire project' })).toHaveCount(1);
			await page.keyboard.press('Escape');
			await expect(dialog.locator('[data-export-channel-option="preserve"] input')).toBeChecked();
			await expect(dialog.locator('[data-export-channel-option="preserve"] input')).toBeDisabled();
			await expect(dialog.locator('[data-export-channel-option="custom"] input')).toBeDisabled();
			await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
			const metadataDialog = page.getByRole('dialog', { name: 'Metadata', exact: true });
			await expect(metadataDialog.getByRole('tab')).toHaveCount(3);
			await metadataDialog.getByRole('tab', { name: 'ADM', exact: true }).click();
			await expect(metadataDialog.locator('input[name="adm-programme-name"]')).toHaveValue('Evening programme');
			await expect(metadataDialog.locator('select[name="adm-bed-layout"]')).toHaveValue('mono');
		}, { timeout: caseTimeout });
	});
});
