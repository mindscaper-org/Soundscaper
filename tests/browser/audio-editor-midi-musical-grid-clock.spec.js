/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, clickClipInterior, clipByName } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { parseMidiFile } from '../../src/common/editor/midi-file.ts';

test.use({ viewport: { width: 1800, height: 1100 } });

async function newPianoRoll(page, editor, workspace) {
	const count = Number(await editor.getAttribute('data-clip-count')) + 1;
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await expect(editor).toHaveAttribute('data-clip-count', String(count));
	await workspace.selectOption('modern');
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	if (!await panel.isVisible()) await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	return panel;
}

async function recordRulerLabels(page) {
	await page.addInitScript(() => {
		globalThis.__midiRulerLabels = new WeakMap();
		const fill = CanvasRenderingContext2D.prototype.fillText;
		const clear = CanvasRenderingContext2D.prototype.clearRect;
		const rectangle = CanvasRenderingContext2D.prototype.fillRect;
		CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
			const labels = globalThis.__midiRulerLabels.get(this.canvas) || [];
			labels.push({ text: String(text), x, y });
			globalThis.__midiRulerLabels.set(this.canvas, labels);
			return fill.call(this, text, x, y, ...rest);
		};
		CanvasRenderingContext2D.prototype.clearRect = function (...args) {
			globalThis.__midiRulerLabels.set(this.canvas, []);
			return clear.apply(this, args);
		};
		CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
			if (x === 0 && y === 0 && height >= this.canvas.height / (devicePixelRatio || 1)) globalThis.__midiRulerLabels.set(this.canvas, []);
			return rectangle.call(this, x, y, width, height);
		};
	});
}

const rulerLabels = canvas => canvas.evaluate(element => globalThis.__midiRulerLabels.get(element) || []);

test('a native MIDI four-measure clip and its offered note grid follow authored later tempos', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/en/');
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	await workspace.selectOption('music');
	await expect(editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true })).toHaveValue('120');
	const createAndDraw = async () => {
		const panel = await newPianoRoll(page, editor, workspace);
		await expect(panel.getByRole('combobox', { name: 'Note grid', exact: true })).toHaveValue('4');
		const grid = panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]');
		await expect.poll(async () => (await grid.boundingBox())?.width ?? 0).toBeGreaterThan(450);
		const rect = await grid.boundingBox();
		if (!rect) throw new Error('The source note grid must be visible.');
		await page.mouse.click(rect.x + 424, rect.y + 56);
		const fields = panel.getByRole('group', { name: 'Note editor', exact: true });
		await expect(fields.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true })).toHaveValue('4.25');
		await expect(fields.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true })).not.toBeDisabled();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		return panel;
	};
	const healthy = await createAndDraw();
	await expect(healthy.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true })).toHaveValue('0.125');
	await healthy.getByRole('button', { name: 'Delete selected notes', exact: true }).click();
	await expect(healthy.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true })).toBeDisabled();
	await workspace.selectOption('music');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const flyout = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await flyout.getByRole('button', { name: 'Add tempo event', exact: true }).click();
	const event = flyout.getByRole('form', { name: 'Tempo event 2', exact: true });
	await event.getByRole('spinbutton', { name: 'Beat position numerator', exact: true }).fill('8');
	await event.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true }).fill('60');
	await event.getByRole('spinbutton', { name: 'Tempo (BPM) denominator', exact: true }).fill('1');
	await event.getByRole('button', { name: 'Save', exact: true }).click();
	await page.keyboard.press('Escape');
	const changed = await createAndDraw();
	await expect(changed.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true })).toHaveValue('0.25');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(project.clips.map(clip => clip.durationFrames)).toEqual([384000, 576000]);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	const download = await downloading;
	try {
		const delivered = parseMidiFile(await downloadBytes(download), { sampleRate: 48000 });
		expect(delivered.tempos).toEqual([{ frame: 0, bpm: 120 }, { frame: 192000, bpm: 60 }]);
		expect(delivered.tracks.flatMap(track => track.notes).map(note => [note.startFrame, note.durationFrames])).toEqual([[204000, 12000]]);
	} finally { await download.delete(); }
});

test('a later authored signature keeps the piano ruler and note-grid measures together', async ({ page }) => {
	await recordRulerLabels(page);
	const editor = await bootEditor(page, '/en/');
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	await workspace.selectOption('music');
	const healthy = await newPianoRoll(page, editor, workspace);
	const pianoRuler = panel => panel.locator('.kw-audio-editor__piano-roll-notes > canvas.timeline-ruler');
	await expect.poll(async () => (await rulerLabels(pianoRuler(healthy))).some(tick => tick.text === '4' && tick.x === 604)).toBe(true);
	await workspace.selectOption('music');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const flyout = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await flyout.getByRole('button', { name: 'Add time signature event', exact: true }).click();
	const event = flyout.getByRole('form', { name: 'Time signature event 2', exact: true });
	await event.getByRole('spinbutton', { name: 'Bar position', exact: true }).fill('2');
	await event.getByRole('spinbutton', { name: 'numerator', exact: true }).fill('3');
	await event.getByRole('spinbutton', { name: 'denominator', exact: true }).fill('4');
	await event.getByRole('button', { name: 'Save', exact: true }).click();
	await page.keyboard.press('Escape');
	const changed = await newPianoRoll(page, editor, workspace);
	await expect.poll(async () => (await rulerLabels(pianoRuler(changed))).some(tick => tick.text === '4' && tick.x === 554)).toBe(true);
	const canvas = changed.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"] > canvas');
	const colors = await canvas.evaluate(element => {
		const context = element.getContext('2d');
		const ratio = element.width / element.getBoundingClientRect().width;
		return [400, 550].map(x => Array.from(context.getImageData(Math.round(x * ratio), Math.round(9 * ratio), 1, 1).data));
	});
	expect(colors[0][3]).toBe(255);
	expect(colors[1]).toEqual(colors[0]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(project.clips.map(clip => clip.durationFrames)).toEqual([384000, 336000]);
});

test('the native4/8 half-bar pulse has the same name in both shipped musical rulers', async ({ page }) => {
	await recordRulerLabels(page);
	const editor = await bootEditor(page, '/en/');
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	await workspace.selectOption('music');
	const denominator = editor.getByRole('spinbutton', { name: 'Time signature: denominator', exact: true });
	await denominator.fill('8'); await denominator.blur();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'MIDI track (beta)']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const ruler = editor.locator('[data-ruler]');
	await ruler.press('Shift+F10');
	await page.locator('.timeline-ruler-context-menu').getByRole('menuitem', { name: 'Beats & measures', exact: true }).click();
	for (let index = 0; index < 3; index++) await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
	await expect.poll(async () => (await rulerLabels(editor.locator('[data-musical-map-ruler]'))).some(tick => tick.text === '1.3')).toBe(true);
	await workspace.selectOption('modern');
	await clickClipInterior(page, clipByName(editor, 'MIDI track (beta)'));
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const grid = panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]');
	const box = await grid.boundingBox();
	if (!box) throw new Error('The source note grid must be visible.');
	await page.mouse.move(box.x + 2, box.y + 30);
	await page.keyboard.down('Control');
	try { for (let index = 0; index < 8; index++) await page.mouse.wheel(0, -100); }
	finally { await page.keyboard.up('Control'); }
	const canvas = panel.locator('.kw-audio-editor__piano-roll-notes > canvas.timeline-ruler');
	await expect.poll(async () => (await rulerLabels(canvas)).some(tick => tick.text === '1.3')).toBe(true);
});
