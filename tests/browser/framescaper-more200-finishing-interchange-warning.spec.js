/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

for (const masked of [false, true]) test(`cut-only delivery discloses native mask=${masked}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('Mask delivery.webm')]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Video preview']);
	await expect(editor.getByRole('heading', { name: 'Video preview', exact: true })).toHaveCount(0);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }); await clip.press('Enter');
	if (masked) {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Edit Video Mask/Matte']);
		const authoring = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
		await authoring.getByRole('spinbutton', { name: 'Width', exact: true }).fill('0.5');
		await authoring.getByRole('button', { name: 'Create and attach mask', exact: true }).click();
		await expect(authoring.getByRole('status')).toHaveText('Selected authored state applied.');
		await authoring.getByRole('button', { name: 'Close', exact: true }).click();
	}
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
	const timeline = JSON.parse(Buffer.from(await downloadBytes(await downloading)).toString('utf8'));
	const clips = timeline.tracks.children.filter(track => track.kind === 'Video').flatMap(track => track.children).filter(item => item.OTIO_SCHEMA === 'Clip.1');
	expect(clips).toHaveLength(1); expect(clips[0].effects ?? []).toEqual([]);
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report.locator('[data-severity="warning"]').filter({ hasText: /mask/u })).toHaveCount(masked ? 1 : 0);
	await report.getByRole('button', { name: 'Close', exact: true }).last().click();
	if (masked) {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Edit Video Mask/Matte']);
		await expect(page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true }).getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('0.5');
	}
});
