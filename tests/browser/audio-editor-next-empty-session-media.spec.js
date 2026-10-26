/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';
import { clipByName } from './audio-editor-clip-locators.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

test('File Open retains a healthy recording beside an empty DAWproject media file', async ({ page }) => {
	const projectXml = `<Project version="1.0"><Structure><Track id="track" name="Recording" contentType="audio"><Channel role="regular"/></Track></Structure>
	<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips>
	<Clip time="0" duration="0.1"><Audio timeUnit="seconds"><File path="empty.wav"/></Audio></Clip>
	<Clip name="Healthy recording" time="0.1" duration="0.1"><Audio timeUnit="seconds"><File path="healthy.wav"/></Audio></Clip>
	</Clips></Lanes></Lanes></Arrangement></Project>`;
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>', projectXml, files: [
		{ path: 'empty.wav', blob: new Blob([]) },
		{ path: 'healthy.wav', blob: new Blob([encodeWav([new Float32Array(4_800).fill(0.25)], { sampleRate: 48_000, float: true })]) },
	] });
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Partial.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(clipByName(editor, 'Healthy recording')).toBeVisible();
	await chooseFileAction(page, editor, 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report.locator('[data-severity="error"]')).toContainText('empty.wav');
	await expect(report.locator('[data-severity="error"]')).toContainText('no decoder could read it');
});
