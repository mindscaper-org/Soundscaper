/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeClipProperties, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { readClipGain, setClipGain } from './audio-editor-clip-settings-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('Clip normalization reads a supported nonresident multichannel recording', async ({ page }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'six-channel.wav', duration: 40, frequency: 523, channelCount: 6 })]);
	const clip = editor.locator('[data-clip-id]').first();
	let properties = await openClipProperties(page, editor, clip, { additional: false });
	await setClipGain(properties, -20); await closeClipProperties(properties);
	const owner = { projectId: await editor.getAttribute('data-project-id'), clipId: await clip.getAttribute('data-clip-id') };
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Normalize to −1 dBFS', exact: true }).click();
	// Observe publication without repeatedly opening and closing gain dialogs
	// while the nonresident programme is still being measured and committed.
	await expect.poll(() => storedClipGain(page, owner), { timeout: 30_000 }).toBeGreaterThan(1);
	properties = await openClipProperties(page, editor, clip, { additional: false });
	const gain = await readClipGain(properties);
	expect(gain).toBeGreaterThan(0);
	expect(gain).toBeLessThan(12);
});

async function storedClipGain(page, owner) {
	return page.evaluate(async ({ name, projectId, clipId }) => {
		const request = input => new Promise((resolve, reject) => { input.onsuccess = () => resolve(input.result); input.onerror = () => reject(input.error); });
		const database = await request(indexedDB.open(name));
		try {
			const project = await request(database.transaction('projects').objectStore('projects').get(projectId));
			return project?.clips.find(clip => clip.id === clipId)?.gain ?? 0;
		} finally { database.close(); }
	}, { name: SOUNDSCAPER_DATABASE_NAME, ...owner });
}
