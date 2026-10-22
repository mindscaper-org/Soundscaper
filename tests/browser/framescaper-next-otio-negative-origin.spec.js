/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, closeWorkspacePanel, disableNativeSavePicker, downloadBytes, importFiles,
} from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';

for (const negative of [true, false]) test(`OTIO exports an ordinary ${negative ? 'negative' : 'positive'} programme start timecode`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [videoPreviewBenchmarkMedia.file]);
	const original = await downloadOtio(page, editor);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	const label = `${negative ? '-' : ''}00:00:10:00`;
	const origin = metadata.locator('[data-sequence-start-timecode]');
	await origin.fill(label); await origin.press('Tab'); await expect(origin).toHaveAttribute('data-sequence-start-timecode', label);
	await closeWorkspacePanel(editor, 'metadata');
	const document = await downloadOtio(page, editor);
	expect(document.global_start_time).toEqual({ OTIO_SCHEMA: 'RationalTime.1', value: negative ? -300 : 300, rate: 30 });
	expect(document.tracks).toEqual(original.tracks);
});

async function downloadOtio(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
	return JSON.parse(new TextDecoder().decode(await downloadBytes(await downloading)));
}
