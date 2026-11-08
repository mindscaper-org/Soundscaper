/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, readFile } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
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
	return { editor, errors, setPitch, projectId };
}

for (const held of [false, true]) test(`Plot Spectrum measures the ${held ? 'pending' : 'settled'} requested MIDI pitch`, async ({ page }) => {
	const { editor, errors, setPitch, projectId } = await setup(page);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	// Warm the real analyzer and its old-note cache so a missing publication
	// barrier cannot hide behind first-use module or worker startup.
	await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
	const warm = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	await expect(warm.locator('[data-analysis-report="spectrum"]')).toBeVisible();
	await warm.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(warm).toBeHidden();
	await setPitch(67, held);
	try {
		await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
		const dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
		if (held) {
			await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
			await expect(dialog.locator('[data-analysis-report="spectrum"]')).toBeHidden();
			await page.evaluate(() => globalThis.__releaseMidiWrite());
		}
		await expect(dialog.locator('[data-analysis-report="spectrum"]')).toBeVisible({ timeout: 20_000 });
		const downloadPromise = page.waitForEvent('download');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = await downloadPromise;
		const path = await download.path(); expect(path).not.toBeNull();
		const report = JSON.parse(await readFile(path, 'utf8'));
		await expect.poll(async () => (await persistedProject(page, projectId)).clips.flatMap(clip => readMidiClip(clip)?.notes ?? [])[0]?.pitch).toBe(67);
		expect(Math.abs(report.report.peak.frequency - 391.99543598174927)).toBeLessThanOrEqual(report.report.sampleRate / report.report.size);
		expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__releaseMidiWrite?.()); }
});

test('closing Plot Spectrum during MIDI publication keeps the requested note and leaves analysis closed', async ({ page }) => {
	const { editor, errors, setPitch, projectId } = await setup(page);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await setPitch(67, true);
	const dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	try {
		await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(dialog).toBeHidden();
		await page.evaluate(() => globalThis.__releaseMidiWrite());
		await expect.poll(async () => (await persistedProject(page, projectId)).clips.flatMap(clip => readMidiClip(clip)?.notes ?? [])[0]?.pitch).toBe(67);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await expect(dialog).toBeHidden();
		expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__releaseMidiWrite?.()); }
});
