/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, stubStorageEstimate } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';
import { readMidiClip } from '../../src/common/editor/midi-model.ts';

test('toolbar Stop cancels pending MIDI Record and an immediate retry records the completed note edit', async ({ page }) => {
	await installOscillatorMicrophone(page);
	await stubStorageEstimate(page, { usage: 0, quota: 2 ** 30 });
	await page.addInitScript(() => { globalThis.__holdMidiWrite = false; globalThis.__midiWriteEntered = false; });
	await page.route(/\/midi-service-[^/]+\.js$/u, async route => {
		const response = await route.fetch();
		const body = await response.text();
		const factory = body.match(/([\w$]+)\s+as\s+createMidiService/u);
		expect(factory).not.toBeNull();
		// Delay one real PCM write; retain the production MIDI service, storage,
		// project commands, and recording admission on both sides of that delay.
		const observed = body.replace(factory[0], 'observedMidiFactory as createMidiService') + `
const observedMidiFactory=(dependencies)=>${factory[1]}({...dependencies,store:{
 deleteSource:(...args)=>dependencies.store.deleteSource(...args),
 async beginSourceWrite(...args){const writer=await dependencies.store.beginSourceWrite(...args);return {
  write:async(...channels)=>{if(globalThis.__holdMidiWrite){globalThis.__holdMidiWrite=false;globalThis.__midiWriteEntered=true;await new Promise(resolve=>{globalThis.__releaseMidiWrite=resolve;});}return writer.write(...channels);},
  commit:(...args)=>writer.commit(...args),abort:(...args)=>writer.abort(...args)
 };}
}});`;
		await route.fulfill({ response, body: observed });
	});
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	await panel.getByRole('button', { name: 'Add note', exact: true }).click();
	const pitch = panel.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true });
	await expect(pitch).toHaveValue('60');
	await page.evaluate(() => { globalThis.__holdMidiWrite = true; });
	await pitch.fill('67');
	await pitch.press('Tab');
	await expect.poll(() => page.evaluate(() => globalThis.__midiWriteEntered)).toBe(true);
	const recordSlot = editor.locator('[data-transport="record"]');
	const record = recordSlot.locator('.kw-audio-editor__split-button-main button');
	const options = recordSlot.getByRole('button', { name: 'Record options', exact: true });
	const stop = editor.getByRole('button', { name: 'Stop', exact: true });
	const monitoring = page.locator('[data-record-flyout]').getByRole('checkbox', { name: 'Monitor input', exact: true });
	try {
		await record.click();
		await options.click();
		await expect(monitoring).toBeDisabled();
		await page.keyboard.press('Escape');
		await stop.click();
		await options.click();
		await expect(monitoring).toBeEnabled();
		await page.keyboard.press('Escape');
		await record.click();
		await options.click();
		await expect(monitoring).toBeDisabled();
		await page.keyboard.press('Escape');
		await page.evaluate(() => globalThis.__releaseMidiWrite());
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
		const startedAt = Number(await playhead.getAttribute('aria-valuenow'));
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(startedAt + 6000);
		await stop.click();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const saved = await persistedProject(page, projectId);
		expect(saved.clips.flatMap(clip => readMidiClip(clip)?.notes ?? []).map(note => note.pitch)).toEqual([67]);
		expect(errors).toEqual([]);
	} finally {
		await page.evaluate(() => globalThis.__releaseMidiWrite?.());
		await stop.click();
	}
});
