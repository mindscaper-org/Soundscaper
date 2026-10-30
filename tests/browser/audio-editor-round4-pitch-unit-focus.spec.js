/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('changing clip pitch units retains the toggle for continued keyboard editing', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	const trigger = panel.getByRole('button', { name: /^Pitch unit:/u });
	for (const label of ['Percent change', 'Semitones (half-steps)']) {
		await trigger.focus();
		await trigger.press('Enter');
		await expect(trigger).toBeFocused();
		await expect(trigger).toHaveAccessibleName(`Pitch unit: ${label}`);
		await expect(trigger).toHaveAttribute('aria-pressed', String(label === 'Percent change'));
	}
});
