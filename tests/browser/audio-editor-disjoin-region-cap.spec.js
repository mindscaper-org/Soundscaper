/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, chooseExportProjectFileAction,
	disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project.ts';

for (const pauses of [128, 129]) test(`silence splitting completes or refuses atomically at ${pauses} pauses`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const samples = new Float32Array(pauses * 1920 + 960);
	for (let frame = 0; frame < samples.length; frame++) samples[frame] = .2 * Math.sin(2 * Math.PI * 440 * frame / 48_000);
	for (let index = 0; index < pauses; index++) samples.fill(0, 960 + index * 1920, 1920 + index * 1920);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-track-row]').first().locator('.track-control-panel__track-name-text').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	await importFiles(editor, [{ name: 'Podcast pauses.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([samples], { sampleRate: 48_000, float: true })) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split clips at silences']);
	if (pauses === 128) await expect(editor.locator('[data-status]')).toHaveText('Done');
	else {
		const alert = page.getByRole('alert').filter({ hasText: 'More than 128 silent regions were found. Select a smaller range.' });
		await expect(alert).toBeVisible();
		await expect(alert).toContainText('More than 128 silent regions were found. Select a smaller range.');
	}
	await expect(editor).toHaveAttribute('data-clip-count', String(pauses === 128 ? 129 : 1));
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const bytes = await downloadBytes(download); await download.delete();
	const project = JSON.parse(strFromU8(unzipSync(bytes)['project.json']));
	expect(validateSoundscaperProject(project)).toBe(true);
	expect(project.sources).toHaveLength(1);
	expect(project.sources[0].frameCount).toBe(samples.length);
	expect(project.clips).toHaveLength(pauses === 128 ? 129 : 1);
	if (pauses === 129) {
		expect(project.clips[0].timelineStartFrame).toBe(0);
		expect(project.clips[0].sourceStartFrame).toBe(0);
		expect(project.clips[0].durationFrames).toBe(samples.length);
	}
});
