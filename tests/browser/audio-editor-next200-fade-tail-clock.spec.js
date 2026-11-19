/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker,
	clipField, commitInput, downloadBytes, importFiles, openClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { createMusicalEndingDurationTimeCodeMap } from '../../src/common/editor/ui/time-code-musical-map.ts';

for (const changing of [true, false]) test(`a tail-measured musical fade-out survives numeric properties, history and export with ${changing ? 'changing' : 'constant'} tempo`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [createWavFixture({ name: 'Fade tail.wav', duration: 6, frequency: 440 })]);
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill('60'); await tempo.press('Enter');
	if (changing) {
		await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
		const musical = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
		await musical.getByRole('button', { name: 'Add tempo event', exact: true }).click();
		const second = musical.getByRole('form', { name: 'Tempo event 2', exact: true });
		await expect(second.locator('[name="beatNum"]')).toHaveValue('4');
		await second.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true }).fill('120');
		await second.getByRole('button', { name: 'Save', exact: true }).click();
		await page.keyboard.press('Escape');
	}
	const projectId = await editor.getAttribute('data-project-id');
	const expectedTempo = [{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
		...changing ? [{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } }] : []];
	await expect.poll(async () => (await persistedProject(page, projectId))?.tempoMap.events.map(({ beat, bpm }) => ({ beat, bpm })))
		.toEqual(expectedTempo);
	const authored = await persistedProject(page, projectId), authoredClip = authored.clips[0];
	expect(authored.sampleRate).toBe(48_000); expect(authoredClip.durationFrames).toBe(288_000);
	// Main's audio fields are numeric seconds. Retain the owning tail-clock
	// conversion against the actual saved tempo map before entering that value.
	const clock = createMusicalEndingDurationTimeCodeMap(authored, authoredClip.timelineStartFrame + authoredClip.durationFrames);
	const seconds = clock.toSeconds(1, 1), expectedFrames = changing ? 96_000 : 192_000;
	expect(Math.round(seconds * authored.sampleRate)).toBe(expectedFrames);
	expect(clock.fromSeconds(seconds)).toEqual({ bar: 1, beat: 1, beatsPerBar: 4 });
	const readFadeFrames = async () => {
		const savedClip = (await persistedProject(page, projectId))?.clips.find(clip => clip.id === authoredClip.id);
		expect(savedClip).toBeDefined();
		return savedClip.fadeOutFrames ?? 0;
	};
	const properties = await openClipProperties(page, editor);
	await showClipTimingFields(properties);
	const fade = clipField(properties, 'fadeOutFrames');
	await commitInput(fade, '0'); await expect(fade).toHaveValue('0'); await expect.poll(readFadeFrames).toBe(0);
	await commitInput(fade, String(seconds)); await expect(fade).toHaveValue(String(seconds));
	await expect.poll(readFadeFrames).toBe(expectedFrames);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fade).toHaveValue('0'); await expect.poll(readFadeFrames).toBe(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(fade).toHaveValue(String(seconds)); await expect.poll(readFadeFrames).toBe(expectedFrames);
	const download = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const files = unzipSync(await downloadBytes(await download));
	const project = JSON.parse(strFromU8(files['project.json']));
	expect(project.clips[0].fadeOutFrames).toBe(changing ? 96_000 : 192_000);
});
