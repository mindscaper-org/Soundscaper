/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('cut-only export discloses forward and reversed playback', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * 2);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false }); await importFiles(editor, [monoTone]);
	for (const reversed of [false, true]) await test.step(`reversed playback=${String(reversed)}`, async () => {
		if (reversed) {
			const properties = await openClipProperties(page, editor, clipByName(editor, monoTone.name), { additional: false });
			await properties.getByRole('switch', { name: 'Reverse', exact: true }).click(); await closeClipProperties(properties);
		}
		const downloading = page.waitForEvent('download'); await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
		const timeline = JSON.parse(Buffer.from(await downloadBytes(await downloading)).toString('utf8'));
		const clips = timeline.tracks.children.filter(track => track.kind === 'Audio').flatMap(track => track.children).filter(child => child.OTIO_SCHEMA === 'Clip.1');
		expect(clips).toHaveLength(1); expect(clips[0].effects ?? []).toEqual([]);
		await chooseCommandAction(page, editor, 'File', 'Delivery Report'); const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
		await expect(report.locator('[data-severity="warning"]').filter({ hasText: 'reversed playback' })).toHaveCount(reversed ? 1 : 0);
		await report.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(report).toBeHidden();
	}, { timeout: caseTimeout });
});
