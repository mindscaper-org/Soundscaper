/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportGuideSamples } from './helpers/guide-audio-results.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { readMidiClip } from '../../src/common/editor/midi-model.ts';

async function setup(page) {
	await disableNativeSavePicker(page);
	await page.addInitScript(() => { globalThis.__holdMidiWrite = false; globalThis.__midiWriteEntered = false; });
	await page.route(/\/midi-service-[^/]+\.js$/u, async route => {
		const response = await route.fetch(), body = await response.text();
		const factory = body.match(/([\w$]+)\s+as\s+createMidiService/u);
		expect(factory).not.toBeNull();
		// Delay one real PCM publication, retaining synthesis, storage, commands and DSP.
		const observed = body.replace(factory[0], 'observedMidiFactory as createMidiService') + `
const observedMidiFactory=(dependencies)=>${factory[1]}({...dependencies,store:{
 deleteSource:(...args)=>dependencies.store.deleteSource(...args),
 async beginSourceWrite(...args){const writer=await dependencies.store.beginSourceWrite(...args);return{
  write:async(...channels)=>{if(globalThis.__holdMidiWrite){globalThis.__holdMidiWrite=false;globalThis.__midiWriteEntered=true;await new Promise(resolve=>{globalThis.__releaseMidiWrite=resolve;});}return writer.write(...channels);},
  commit:(...args)=>writer.commit(...args),abort:(...args)=>writer.abort(...args)
 };}
}});`;
		await route.fulfill({ response, body: observed });
	});
	const errors = collectClientErrors(page), editor = await bootEditor(page, '/embed/en/');
	const bytes = writeMidiFile({ sampleRate: 48_000, tempos: [{ frame: 0, bpm: 120 }],
		signatures: [{ frame: 0, numerator: 4, denominator: 4 }], tracks: [{ name: 'Requested note', durationFrames: 48_000,
			notes: [{ id: 'note', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 48_000 }] }] });
	await importFiles(editor, [{ name: 'Requested.mid', mimeType: 'audio/midi', buffer: Buffer.from(bytes) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const projectId = await editor.getAttribute('data-project-id');
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	await panel.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const pitch = panel.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true });
	const setPitch = async (value, held = false) => {
		if (held) await page.evaluate(() => { globalThis.__holdMidiWrite = true; });
		await pitch.fill(String(value)); await pitch.press('Tab');
		if (held) await expect.poll(() => page.evaluate(() => globalThis.__midiWriteEntered)).toBe(true);
		else await expect.poll(async () => {
			const project = await persistedProject(page, projectId);
			return project.clips.flatMap(clip => readMidiClip(clip)?.notes ?? [])[0]?.pitch;
		}).toBe(value);
	};
	return { editor, errors, setPitch };
}

for (const held of [false, true]) test(`Invert applies signed PCM to the ${held ? 'pending' : 'settled'} requested MIDI note`, async ({ page }) => {
	const { editor, errors, setPitch } = await setup(page);
	await setPitch(67);
	const reference = await exportGuideSamples(page);
	if (held) { await setPitch(60); await setPitch(67, true); }
	try {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
		if (held) {
			await expect(editor.locator('[data-status]')).not.toHaveText('Applied the Audacity effect.');
			await page.evaluate(() => globalThis.__releaseMidiWrite());
		}
		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
		const rendered = await exportGuideSamples(page);
		expect(rendered.sampleRate).toBe(reference.sampleRate);
		const input = reference.channels[0], output = rendered.channels[0];
		let error = 0, peak = 0, crossings = 0;
		const from = Math.round(.1 * rendered.sampleRate), to = Math.round(.6 * rendered.sampleRate);
		for (let frame = from + 1; frame < to; frame++) {
			error = Math.max(error, Math.abs(output[frame] + input[frame]));
			peak = Math.max(peak, Math.abs(output[frame]));
			if (output[frame - 1] <= 0 && output[frame] > 0) crossings++;
		}
		expect(peak).toBeGreaterThan(.03);
		expect(error).toBeLessThan(3 / 32768);
		expect(crossings * rendered.sampleRate / (to - from)).toBeGreaterThan(380);
		expect(crossings * rendered.sampleRate / (to - from)).toBeLessThan(405);
		expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__releaseMidiWrite?.()); }
});

test('Cancel closes Amplify while MIDI publication is pending and late readiness leaves it closed', async ({ page }) => {
	const { editor, errors, setPitch } = await setup(page);
	await setPitch(67, true);
	try {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
		const dialog = page.locator('[data-selection-effects-dialog]');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		await page.evaluate(() => globalThis.__releaseMidiWrite());
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await expect(dialog).toBeHidden();
		await expect(editor.getByRole('alert')).toHaveCount(0);
		expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__releaseMidiWrite?.()); }
});
