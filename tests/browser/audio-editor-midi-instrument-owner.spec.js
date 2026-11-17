/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativePluginParameterHost } from './helpers/native-plugin-parameter-host.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { readMidiTrack } from '../../src/common/editor/midi-model.ts';

test('Instrument settings never edits a native instance assigned to a different MIDI track', async ({ page }) => {
	await installNativePluginParameterHost(page, { instrument: true });
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	await panel.getByRole('button', { name: 'Add note', exact: true }).click();
	const id = await editor.getAttribute('data-project-id');
	const instrument = panel.getByRole('combobox', { name: 'Instrument', exact: true });
	await instrument.selectOption('native:gain-install');
	const readTracks = async () => (await persistedProject(page, id)).tracks.filter(track => readMidiTrack(track));
	await expect.poll(async () => typeof readMidiTrack((await readTracks())[0])?.instrument).toBe('object');
	await instrument.selectOption('native:settings');
	const dialog = page.getByRole('dialog', { name: 'Instrument settings', exact: true });
	await dialog.getByRole('button', { name: 'Test Gain', exact: true }).click();
	await dialog.locator('[data-native-plugin-instantiate="gain-install"]').click();
	await expect(dialog.locator('[data-native-plugin-parameter="gain"]')).toHaveValue('0.25');
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	const before = readMidiTrack((await readTracks())[0]).instrument;
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await panel.getByRole('button', { name: 'Add note', exact: true }).click();
	await instrument.selectOption('native:gain-install');
	await expect.poll(async () => typeof readMidiTrack((await readTracks())[1])?.instrument).toBe('object');
	await instrument.selectOption('native:settings');
	await expect(dialog.locator('[data-native-plugin-instance]')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Test Gain', exact: true }).click();
	await dialog.locator('[data-native-plugin-instantiate="gain-install"]').click();
	await dialog.locator('[data-native-plugin-parameter="gain"]').press('Home');
	await dialog.locator('[data-native-plugin-persist-state]').click();
	await expect.poll(async () => readMidiTrack((await readTracks())[1]).instrument.state).not.toBe(before.state);
	expect(readMidiTrack((await readTracks())[0]).instrument).toEqual(before);
});
