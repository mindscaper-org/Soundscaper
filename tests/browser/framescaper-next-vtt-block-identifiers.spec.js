/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const styled of [true, false]) test(`ordinary WebVTT block-word identifiers import as ${styled ? 'styled captions' : 'labels'}`, async ({ page }) => {
	const text = 'WEBVTT\n\nSTYLE introduction\n00:00:00.000 --> 00:00:01.000\nOpening dialogue\n\nREGION A\n00:00:01.000 --> 00:00:02.000\nClosing dialogue\n';
	const editor = await bootEditor(page, styled ? '/framescaper/embed/en/' : '/embed/en/');
	// The browser's independent WebVTT parser identifies ordinary cues, not CSS/region blocks.
	const reference = await page.evaluate(async body => {
		const video = document.createElement('video'), track = document.createElement('track');
		video.hidden = true;
		const url = URL.createObjectURL(new Blob([body], { type: 'text/vtt' }));
		try {
			const loaded = new Promise((resolve, reject) => {
				track.onload = resolve; track.onerror = () => reject(new Error('The reference WebVTT could not be read.'));
			});
			track.src = url; video.append(track); document.body.append(video); track.track.mode = 'hidden'; await loaded;
			return Array.from(track.track.cues ?? [], cue => ({ text: cue.text, start: cue.startTime, end: cue.endTime }));
		} finally { video.remove(); URL.revokeObjectURL(url); }
	}, text);
	expect(reference).toEqual([
		{ text: 'Opening dialogue', start: 0, end: 1 },
		{ text: 'Closing dialogue', start: 1, end: 2 },
	]);
	const file = { name: 'Dialogue.vtt', mimeType: 'text/vtt', buffer: Buffer.from(text) };
	if (styled) {
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
		const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
		await dialog.locator('[data-framescaper-caption-file]').setInputFiles(file);
		await expect(dialog.locator('[data-framescaper-finishing-document]')).toHaveValue(/Closing dialogue/u);
		const tracks = JSON.parse(await dialog.locator('[data-framescaper-finishing-document]').inputValue());
		expect(tracks[0].cues.map(cue => ({ text: cue.text, start: cue.startFrame, end: cue.endFrame }))).toEqual([
			{ text: 'Opening dialogue', start: 0, end: 48_000 }, { text: 'Closing dialogue', start: 48_000, end: 96_000 },
		]);
	} else {
		await importFiles(editor, [file]);
		const labels = editor.locator('[data-label-id]');
		await expect(labels).toHaveCount(2);
		await expect(labels.locator('[data-label-banner]')).toHaveText(['Opening dialogue', 'Closing dialogue']);
		await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(labels).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(labels.locator('[data-label-banner]')).toHaveText(['Opening dialogue', 'Closing dialogue']);
	}
});
