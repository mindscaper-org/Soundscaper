/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { openFramescaperSourcePropertiesFromBin } from './helpers/framescaper-source-properties.js';

for (const reordered of [false, true]) test(`File Import retains WebM source facts when video settings come ${reordered ? 'before' : 'after'} TrackType`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const file = createDeterministicSilentVideoFixture('Reordered camera.webm');
	if (reordered) {
		const bytes = file.buffer;
		const entry = bytes.indexOf(Buffer.from([0xae, 0xa7, 0xd7]));
		const type = bytes.indexOf(Buffer.from([0x83, 0x81, 0x01]), entry);
		const video = bytes.indexOf(Buffer.from([0xe0, 0x8a]), type);
		expect(entry).toBeGreaterThan(0);
		expect(type).toBeGreaterThan(entry);
		expect(video).toBeGreaterThan(type);
		file.buffer = Buffer.concat([bytes.subarray(0, type), bytes.subarray(video, video + 12), bytes.subarray(type, video), bytes.subarray(video + 12)]);
	}
	await editor.locator('[data-project-bin-input]').setInputFiles(file);
	const card = editor.getByRole('listitem', { name: 'Project bin: Reordered camera', exact: true });
	await expect(card).toBeVisible({ timeout: 30_000 });
	const properties = await openFramescaperSourcePropertiesFromBin(page, editor, 'Reordered camera');
	await expect(properties.locator('[data-source-property="Video codec"] dd')).toHaveText('vp8');
	await expect(properties.locator('[data-source-property="Coded size"] dd')).toHaveText('96 × 54');
	await expect(properties.locator('[data-source-property="Alpha channel"] dd')).not.toHaveText('Unknown');
	await expect(properties.locator('[data-source-property="Timing"] dd')).toHaveText('exact (container)');
});
