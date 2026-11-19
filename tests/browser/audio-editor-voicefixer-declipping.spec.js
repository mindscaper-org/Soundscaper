/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles, registerAudioEditorHooks,
	stubStorageEstimate } from './audio-editor-test-helpers.js';
import { openAssistanceTask } from './helpers/assistance-task-menu.js';
import { completeMilestone7Run, installMilestone7LocalAssistanceFixture,
	milestone7FixtureSnapshot } from './helpers/milestone-7-local-assistance.js';

test.describe('VoiceFixer speech declipping', () => {
	registerAudioEditorHooks();
	test('opts in through the repair menu, applies the chosen model and restores the original with Undo', async ({ page }) => {
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await installMilestone7LocalAssistanceFixture(page, [
			['voicefixer', '1.0.0', 'speech-enhancement'],
		]);
		const errors = collectClientErrors(page), editor = await bootEditor(page, '/en/');
		const audio = createWavFixture({ name: 'clipped-speech.wav', frequency: 330,
			duration: 1, sampleRate: 44_100, channelCount: 2 });
		await importFiles(editor, [audio]);
		const original = clipByName(editor, audio.name).first(); await original.focus(); await page.keyboard.press('Enter');
		page.on('dialog', dialog => { void dialog.accept(); });
		const dialog = await openAssistanceTask(page, editor, 'Enhance Dialogue');
		const picker = dialog.getByRole('button', { name: /^Model(?::|$)/u });
		await expect(picker).toContainText('DeepFilterNet3');
		await picker.click(); await page.getByRole('option', { name: 'VoiceFixer — speech declipping and restoration', exact: true }).click();
		await expect(dialog).toContainText('Restores clipped speech');
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect.poll(() => milestone7FixtureSnapshot(page).then(value => value.progressEvents)).toBe(1);
		const selected = await page.evaluate(() => [...globalThis.__milestone7Fixture.requests.values()].at(-1).models);
		expect(selected).toEqual([expect.objectContaining({ modelId: 'voicefixer', version: '1.0.0' })]);
		await completeMilestone7Run(page);
		await expect(dialog).toBeHidden(); await expect(clipByName(editor, 'Enhanced Dialogue')).toBeVisible();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, audio.name)).toBeVisible(); expect(errors).toEqual([]);
	});
});
