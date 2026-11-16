/* SPDX-License-Identifier: AGPL-3.0-only */

import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, clickClipInterior, clipByName, disableNativeSavePicker, downloadBytes, importFiles, openEffectsForTrack, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { ardourSession, soundcraftSession } from '../helpers/native-daw-import-fixtures.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { ardourMidiBytes, ardourMidiSession, soundcraftMidiSession } from '../helpers/project-midi-import-fixtures.ts';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { readMidiClip } from '../../src/common/editor/midi-model.ts';

test('File Import opens Ardour and SoundCraft audio sessions and File Open restores a SoundCraft bundle', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const wav = Buffer.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true }));
	for (const [name, mimeType, text] of [['voice.ardour', 'application/xml', ardourSession(true)],
		['voice.scraft', 'application/json', JSON.stringify(soundcraftSession())]]) {
		await importFiles(editor, [{ name, mimeType, buffer: Buffer.from(text) }, { name: 'voice.wav', mimeType: 'audio/wav', buffer: wav }]);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
		const exporting = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
		const download = await exporting;
		const otio = JSON.parse(Buffer.from(await downloadBytes(download)).toString('utf8'));
		const children = otio.tracks.children[0].children;
		expect(children[0].source_range.duration.value / children[0].source_range.duration.rate).toBe(.5);
		expect(children[1].source_range.start_time.value / children[1].source_range.start_time.rate).toBe(.25);
		expect(children[1].source_range.duration.value / children[1].source_range.duration.rate).toBe(.5);
		await download.delete();
	}
	const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
	await writer.add('voice.scraft', new TextReader(JSON.stringify(soundcraftSession())));
	await writer.add('Audio Files/voice.wav', new BlobReader(new Blob([wav])));
	const bundle = Buffer.from(await (await writer.close()).arrayBuffer());
	const previous = await editor.getAttribute('data-project-id');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'voice.scraftz', mimeType: 'application/zip', buffer: bundle });
	await expect(editor).not.toHaveAttribute('data-project-id', previous);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
});

test('File Import makes Ardour and SoundCraft MIDI editable through Window Piano roll and retains edits after reload', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const session = soundcraftMidiSession();
	for (const files of [
		[{ name: 'notes.ardour', mimeType: 'application/xml', buffer: Buffer.from(ardourMidiSession()) },
			{ name: 'keys.mid', mimeType: 'audio/midi', buffer: Buffer.from(ardourMidiBytes()) }],
		[{ name: 'notes.scraft', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...session, tracks: [session.tracks[1]] })) }],
	]) {
		const previousId = await editor.getAttribute('data-project-id');
		await importFiles(editor, files);
		await expect(editor).not.toHaveAttribute('data-project-id', previousId);
		await waitForProjectActivation(editor);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await clickClipInterior(page, clipByName(editor, 'MIDI phrase'));
		const noteEditor = editor.getByRole('group', { name: 'Note editor', exact: true });
		if (!await noteEditor.isVisible()) await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
		await noteEditor.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
		await expect(noteEditor.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('64');
		await noteEditor.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true }).fill('67');
		await noteEditor.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true }).press('Tab');
		const projectId = await editor.getAttribute('data-project-id');
		await expect.poll(async () => (await persistedProject(page, projectId)).clips.flatMap(clip => readMidiClip(clip)?.notes ?? [])[0]?.pitch).toBe(67);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload({ waitUntil: 'domcontentloaded' });
		editor = await waitForEditor(page);
		await waitForProjectActivation(editor);
		await clickClipInterior(page, clipByName(editor, 'MIDI phrase'));
		const restored = editor.getByRole('group', { name: 'Note editor', exact: true });
		if (!await restored.isVisible()) await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
		await restored.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
		await expect(restored.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('67');
	}
});

test('imported automation remains editable and foreign realtime effect state survives reload', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true, showProjectBin: false });
	const original = soundcraftSession();
	const session = { ...original, tracks: original.tracks.map(track => ({ ...track, mixer: { ...track.mixer,
		inserts: [{ plugin: 'clap:org.example.echo', params: { mix: .3 }, state: 'AQID', active: true, bypass: false }] },
		automation: [{ param: 'Volume', enabled: true, points: [{ at: 0, value: -12 }, { at: 48000, value: -6 }] },
			{ param: 'Mute', enabled: true, points: [{ at: 0, value: 0 }, { at: 48000, value: 1 }] }],
	})) };
	const previousId = await editor.getAttribute('data-project-id');
	await importFiles(editor, [{ name: 'Mix.scraft', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(session)) },
		{ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true })) }]);
	await expect(editor).not.toHaveAttribute('data-project-id', previousId); await waitForProjectActivation(editor);
	const projectId = await editor.getAttribute('data-project-id');
	await expect.poll(async () => (await persistedProject(page, projectId)).automationLanes.length).toBe(2);
	const panel = await openEffectsForTrack(editor, 0);
	await expect(panel.getByRole('group', { name: /^Missing:/u })).toBeVisible();
	const row = clipByName(editor, 'Phrase').locator('xpath=ancestor::div[@data-track-row]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const controls = row.locator('[data-track-automation-controls]'); await expect(controls).toBeVisible();
	const gainHit = row.locator('[data-automation-insert-point]').first();
	await gainHit.evaluate(element => { const bounds = element.getBoundingClientRect(); element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: bounds.left + bounds.width * .25, clientY: bounds.top + bounds.height * .5 })); });
	await editor.getByRole('menu', { name: 'Automation curve', exact: true }).getByRole('menuitemradio', { name: 'Hold', exact: true }).click();
	await expect.poll(async () => (await persistedProject(page, projectId)).automationLanes.find(lane => lane.address.parameterId === 'gain').segments.some(segment => segment.kind === 'hold')).toBe(true);
	await page.reload({ waitUntil: 'domcontentloaded' }); editor = await waitForEditor(page); await waitForProjectActivation(editor);
	const restored = await persistedProject(page, projectId);
	expect(restored.automationLanes).toHaveLength(2);
	expect(restored.automationLanes.find(lane => lane.address.parameterId === 'mute').segments.every(segment => segment.kind === 'hold')).toBe(true);
	expect(JSON.stringify(restored.tracks[0].effects[0])).toContain('AQID');
	await expect((await openEffectsForTrack(editor, 0)).getByRole('group', { name: /^Missing:/u })).toBeVisible();
});
