/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeClipProperties, collectClientErrors, importFiles, openClipProperties, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseClipMediaSetting, readClipGain } from './audio-editor-clip-settings-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

for (const [name, rows] of [
	['refusals and measurable recordings', [[.1, .25, false], [1, 0, false], [1, .25, false]]],
]) test(`native normalization reports whether measurement exists for ${name}`, async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * rows.length);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	for (const [index, [duration, amplitude, peakOnly]] of rows.entries()) await test.step(`${duration}s amplitude ${amplitude} ${peakOnly ? 'peak' : 'LUFS'}`, async () => {
		if (index > 0) {
			const previousId = await editor.getAttribute('data-project-id');
			await chooseCommandAction(page, editor, 'File', 'New');
			await expect(editor).not.toHaveAttribute('data-project-id', previousId);
			await waitForProjectActivation(editor);
			await expect(editor).toHaveAttribute('data-clip-count', '0');
		}
		const recording = createWavFixture({ name: 'Recording.wav', duration, frequency: 1000, channelCount: 1, channelAmplitudes: [amplitude] });
		await importFiles(editor, [recording]);
		const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
		const projectId = await editor.getAttribute('data-project-id');
		const normalizedGain = async () => (await persistedProject(page, projectId))?.clips[0]?.gain;
		expect(await readClipGain(properties)).toBe(0);
		await chooseClipMediaSetting(properties, peakOnly ? 'Normalize to −1 dBFS' : 'Normalize to −14 LUFS');
		if (!peakOnly && (duration < .4 || amplitude === 0)) {
			const toast = editor.locator('[data-editor-toast="workspace-error"]');
			await expect(toast.getByRole('alert')).toContainText('Loudness could not be measured');
			await toast.getByRole('button', { name: 'Close', exact: true }).click();
			expect(await readClipGain(properties)).toBe(0);
			if (amplitude > 0) {
				await chooseClipMediaSetting(properties, 'Normalize to −1 dBFS');
				await expect.poll(normalizedGain).toBeGreaterThan(1);
				expect(await readClipGain(properties)).toBeGreaterThan(0);
			}
		} else {
			await expect.poll(normalizedGain).toBeGreaterThan(1);
			expect(await readClipGain(properties)).toBeGreaterThan(0);
			await expect(editor.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
		}
		expect(errors).toEqual([]);
		await closeClipProperties(properties);
	}, { timeout: caseTimeout });
});
