/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

for (const badFirst of [true, false]) test(`File Import keeps a healthy WAV beside a corrupt MIDI, badFirst=${badFirst}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const bad = { name: 'Broken.mid', mimeType: 'audio/midi', buffer: Buffer.from('Not a MIDI file') };
	await editor.locator('[data-import-input]').setInputFiles(badFirst ? [bad, toneA] : [toneA, bad]);
	await expect(editor.getByRole('alert')).toContainText('Not a Standard MIDI file.');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
