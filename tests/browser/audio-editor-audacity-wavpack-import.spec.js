/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, projectTimelineSourceNames, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { createAudacityWavPackFixture } from '../helpers/wavpack-import-fixture.ts';

test('Audacity WavPack continuation blocks import completely and survive a reload', async ({ page }) => {
	const file = {
		name: 'audacity-continuation.wv',
		mimeType: 'audio/wavpack',
		buffer: Buffer.from(await createAudacityWavPackFixture()),
	};
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, file);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	expect(await projectTimelineSourceNames(page, projectId)).toEqual([file.name]);
	const peaks = await sourcePeakChannels(page, file.name);
	expect(peaks.channelCount).toBe(2);
	expect(peaks.channels[0].maximum).toBeCloseTo(0.2, 3);
	expect(peaks.channels[1].maximum).toBeCloseTo(0.1, 3);
	await page.reload();
	await expect(editor).toHaveAttribute('data-editor-ready', 'true');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	expect(await projectTimelineSourceNames(page, projectId)).toEqual([file.name]);
});
