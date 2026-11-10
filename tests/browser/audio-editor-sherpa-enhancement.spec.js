/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles, registerAudioEditorHooks,
	stubStorageEstimate } from './audio-editor-test-helpers.js';
import { openAssistanceTask } from './helpers/assistance-task-menu.js';
import { completeMilestone7Run, installMilestone7LocalAssistanceFixture,
	milestone7FixtureSnapshot } from './helpers/milestone-7-local-assistance.js';

const MODELS = [['gtcrn', '1.0.0', 'speech-enhancement'],
	['dpdfnet2-48khz', '1.0.0', 'speech-enhancement'], ['voxlock', '1.1.1', 'speech-enhancement']];

test.describe('Sherpa enhancement model choices', () => {
	registerAudioEditorHooks();
	test('selects every installed alternative through Enhance Dialogue and undoes each result', async ({ page }) => {
		test.setTimeout(180_000);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await installMilestone7LocalAssistanceFixture(page, MODELS);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/');
		const audio = createWavFixture({ name: 'sherpa-stereo.wav', frequency: 330,
			duration: 4, sampleRate: 48_000, channelCount: 2 });
		await importFiles(editor, [audio]);
		const consents = [];
		page.on('dialog', async (dialog) => { consents.push(dialog.message()); await dialog.accept(); });
		for (const [index, [modelId, version]] of MODELS.entries()) {
			const clip = clipByName(editor, audio.name).first(); await clip.focus(); await page.keyboard.press('Enter');
			const dialog = await openAssistanceTask(page, editor, 'Enhance Dialogue');
			const picker = dialog.getByRole('button', { name: 'Model', exact: true });
			await expect(picker).toBeVisible(); await picker.click();
			await page.getByRole('option', { name: new RegExp(`^${modelId === 'dpdfnet2-48khz' ? 'DPDFNet2' : modelId === 'gtcrn' ? 'GTCRN' : 'VoxLock'}`, 'u') }).click();
			if (modelId === 'voxlock') await expect(dialog).toContainText('loudest three seconds');
			await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
			await expect.poll(() => milestone7FixtureSnapshot(page).then(({ progressEvents }) => progressEvents)).toBe(index + 1);
			const selected = await page.evaluate(() => [...globalThis.__milestone7Fixture.requests.values()].at(-1).models);
			expect(selected).toEqual(expect.arrayContaining([expect.objectContaining({ modelId, version })]));
			await completeMilestone7Run(page);
			await expect(dialog).toBeHidden(); await expect(clipByName(editor, 'Enhanced Dialogue')).toBeVisible();
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(clipByName(editor, audio.name)).toBeVisible();
		}
		expect(errors).toEqual([]);
	});
});
