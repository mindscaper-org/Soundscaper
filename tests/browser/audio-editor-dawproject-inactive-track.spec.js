/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { inactiveDawprojectTrackFile } from '../helpers/dawproject-inactive-track-fixture.ts';

for (const loaded of [true, false]) test(`DAWproject loaded=${loaded} retains silence and deliberate reactivation`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await inactiveDawprojectTrackFile({ loaded });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.'); await expect(editor).toHaveAttribute('data-clip-count', '1');
	const peak = samples => Math.max(...samples.slice(12_000, 36_000).map(Math.abs));
	const samples = await exportSamples(page, editor);
	if (loaded) expect(peak(samples)).toBeGreaterThan(0.1);
	else {
		expect(peak(samples)).toBeLessThan(0.0001);
		const mute = editor.getByRole('group', { name: 'Voice track controls', exact: true })
			.getByRole('button', { name: 'Mute', exact: true });
		await expect(mute).toHaveAttribute('aria-pressed', 'true'); await mute.click();
		expect(peak(await exportSamples(page, editor))).toBeGreaterThan(0.1);
	}
});
