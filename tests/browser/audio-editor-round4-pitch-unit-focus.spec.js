/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, clipField, commitInput, importFiles, openClipProperties, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

registerAudioEditorHooks();

test('changing clip pitch units keeps the unit toggle focused for continued keyboard editing', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name), clipId = await clip.getAttribute('data-clip-id');
	expect(clipId).not.toBeNull();
	const panel = await openClipProperties(page, editor, clip);
	await commitInput(clipField(panel, 'pitchCents'), '12');
	const trigger = panel.locator('[data-clip-pitch-unit]');
	await expect(trigger).toHaveAttribute('aria-pressed', 'false');
	await trigger.focus();
	for (const [label, pressed, value] of [['Percent change', 'true', '100'], ['Semitones (half-steps)', 'false', '12']]) {
		await trigger.press('Enter');
		await expect(trigger).toBeFocused();
		await expect(trigger).toHaveAttribute('aria-label', `Pitch unit: ${label}`);
		await expect(trigger).toHaveAttribute('aria-pressed', pressed);
		await expect(clipField(panel, 'pitchCents')).toHaveValue(value);
		await expect.poll(async () => (await persistedProject(page, await editor.getAttribute('data-project-id')))
			?.clips.find(saved => saved.id === clipId)?.pitchCents).toBe(1_200);
	}
});
