/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeClipProperties, closeWorkspacePanel, importFiles, openClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

for (const editAudio of [false, true]) {
	test(`${editAudio ? 'audio' : 'video'} clip timing observes its linked locked peer without blocking independent edits`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('linked-lock.webm')]);
		await closeWorkspacePanel(editor, 'video-preview');
		const audio = editor.getByRole('group', { name: /Audio clip/u }).first();
		const video = editor.getByRole('group', { name: /^Video clip:/u }).first();
		const audioId = await audio.getAttribute('data-clip-id');
		const audibleClip = editor.locator(`[data-clip-id="${audioId}"]`);
		const clipId = await (editAudio ? audio : video).getAttribute('data-clip-id');
		const clip = editor.locator(`[data-clip-id="${clipId}"]`);
		const peerTrackId = await (editAudio ? video : audio).locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-id');
		const peerTrack = editor.locator(`[data-track-row][data-track-id="${peerTrackId}"]`);
		await chooseTrackMenuAction(page, editor, peerTrack, 'Lock track');
		let properties = await openClipProperties(page, editor, clip);
		await showClipTimingFields(properties);
		const upstreamAudio = await properties.locator('[data-clip-properties-field="start"]').count() > 0;
		if (upstreamAudio) {
			await expect(properties.getByRole('textbox', { name: 'Start', exact: true })).toBeDisabled();
			await expect(properties.locator('[data-clip-properties-field="length"] input')).toBeEnabled();
		} else {
			await expect(properties.getByRole('group', { name: 'Start', exact: true })).toHaveAttribute('aria-disabled', 'true');
			await expect(properties.getByRole('group', { name: 'Duration', exact: true })).toHaveAttribute('aria-disabled', String(!editAudio));
			await expect(properties.getByRole('group', { name: 'Source in', exact: true })).toHaveAttribute('aria-disabled', 'false');
		}
		const name = properties.getByRole('textbox', { name: 'Clip name', exact: true });
		await expect(name).toBeEnabled();
		await name.fill('Independent title');
		await name.press('Enter');
		await expect(clip).toHaveAttribute('aria-label', /Independent title/u);
		await closeClipProperties(properties);
		await chooseTrackMenuAction(page, editor, peerTrack, 'Unlock track');
		await clip.locator('.clip-header').click();
		properties = await openClipProperties(page, editor, clip);
		await showClipTimingFields(properties);
		if (upstreamAudio) {
			const start = properties.getByRole('textbox', { name: 'Start', exact: true });
			await expect(start).toBeEnabled();
			await start.fill('1');
			await start.press('Enter');
			await expect(start).toHaveValue('1');
		} else {
			const start = properties.getByRole('group', { name: 'Start', exact: true });
			await expect(start).toHaveAttribute('aria-disabled', 'false');
			await start.locator('.timecode-digit').first().click();
			await page.keyboard.type('000001000');
			await page.keyboard.press('Enter');
			await expect(start.locator('.timecode__display')).toHaveText('00h00m01.000s');
		}
		await expect(audibleClip).toHaveAttribute('aria-label', /starts at 1 second,/u);
	});
}
