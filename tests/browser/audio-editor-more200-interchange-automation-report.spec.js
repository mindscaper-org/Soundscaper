/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const automated of [false, true]) test(`cut-only export discloses authored track automation=${String(automated)}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [monoTone]);
	if (automated) {
		const row = clipByName(editor, monoTone.name).locator('xpath=ancestor::div[@data-track-row]');
		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		const overlay = row.locator('[data-track-automation-overlay]'); const curve = overlay.locator('[data-automation-insert-point]').first();
		await curve.focus(); await curve.press('i'); const points = overlay.locator('[data-automation-point-id]'); await expect(points).toHaveCount(2);
		await points.last().press('Shift+ArrowDown'); await expect(points.last()).toHaveAttribute('aria-valuenow', '0.9');
	}
	const downloading = page.waitForEvent('download'); await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
	const timeline = JSON.parse(Buffer.from(await downloadBytes(await downloading)).toString('utf8'));
	const clips = timeline.tracks.children.filter(track => track.kind === 'Audio').flatMap(track => track.children).filter(child => child.OTIO_SCHEMA === 'Clip.1');
	expect(clips).toHaveLength(1); expect(clips[0].effects ?? []).toEqual([]);
	await chooseCommandAction(page, editor, 'File', 'Delivery Report'); const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report.locator('[data-severity="warning"]').filter({ hasText: 'automation' })).toHaveCount(automated ? 1 : 0);
});
