/* SPDX-License-Identifier: AGPL-3.0-only */

import { readHandbookMacroPrograms } from '../helpers/handbook-macro-programs.ts';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();
const programs = readHandbookMacroPrograms();

function documented(title) {
	const program = programs.find(candidate => candidate.title === title);
	if (!program) throw new Error(`Missing handbook program: ${title}`);
	return program.source;
}

async function openManager(page, editor) {
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await expect(manager).toBeVisible();
	return manager;
}

async function newProgram(manager, source) {
	await manager.locator('[data-macro-programs] > header').getByRole('button', { name: 'New program', exact: true }).click();
	await manager.locator('[data-macro-script-source]').fill(source);
	return manager.locator('[data-macro-script-id][aria-current="true"]').getAttribute('data-macro-script-id');
}

async function run(manager, expectedLog) {
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', 'completed', { timeout: 30000 });
	if (expectedLog) await expect(log).toContainText(expectedLog);
	await expect(manager.locator('[data-macro-script-failure]')).toHaveCount(0);
}

test('the documented self-editing counter persists across runs and a browser reload', async ({ page }) => {
	const errors = collectClientErrors(page);
	let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	let manager = await openManager(page, editor);
	const id = await newProgram(manager, documented('sound.self (1)'));
	await run(manager, 'Run 1');
	await expect(manager.locator('[data-macro-script-source]')).toHaveValue(/^const runs = 1;/u);
	await run(manager, 'Run 2');
	await expect(manager.locator('[data-macro-script-source]')).toHaveValue(/^const runs = 2;/u);
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	await page.reload();
	editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	manager = await openManager(page, editor);
	await manager.locator(`[data-macro-script-id="${id}"]`).click();
	await expect(manager.locator('[data-macro-script-source]')).toHaveValue(/^const runs = 2;/u);
	await run(manager, 'Run 3');
	expect(errors).toEqual([]);
});

test('the documented memory recalls a selection, zoom, scrolling and track heights from the menu', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	const manager = await openManager(page, editor);
	await newProgram(manager, [
		'const tracks = await sound.project.tracks();',
		'await sound.view.set({ pixelsPerSecond: 2000, autoFitTrackHeight: false,',
		'  tracks: tracks.map(track => ({ id: track.id, height: 700 })), scrollX: 240, scrollY: 180 });',
		'await sound.select.frames(2400, 4800, { trackIds: [tracks[0].id] });',
		'const view = await sound.view.snapshot();',
		'sound.assertEqual(view.scrollX, 240); sound.assertEqual(view.scrollY, 180);',
	].join('\n'));
	await run(manager);
	await expect(editor.locator('[data-timeline]')).toHaveJSProperty('scrollLeft', 240);
	await expect(editor.locator('[data-timeline]')).toHaveJSProperty('scrollTop', 180);
	await manager.locator('[data-macro-script-source]').fill(documented('A selection and view memory (1)'));
	const memoryId = await manager.locator('[data-macro-script-id][aria-current="true"]').getAttribute('data-macro-script-id');
	await run(manager, 'Remembered selection and view.');
	await expect(manager.locator('[data-macro-script-source]')).toHaveValue(/await memory\(\{"view"/u);
	await newProgram(manager, [
		'await sound.view.set({ pixelsPerSecond: 4000, scrollX: 500, scrollY: 0 });',
		'await sound.select.none();',
	].join('\n'));
	await run(manager);
	await expect(editor.locator('[data-timeline]')).toHaveJSProperty('scrollLeft', 500);
	await manager.locator(`[data-macro-script-id="${memoryId}"]`).click();
	await run(manager, 'Recalled selection and view.');
	await expect(editor.locator('[data-timeline]')).toHaveJSProperty('scrollLeft', 240);
	await expect(editor.locator('[data-timeline]')).toHaveJSProperty('scrollTop', 180);
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(editor.locator('[data-track-row][data-track-id]').first()).toHaveCSS('height', '700px');
	expect(errors).toEqual([]);
});

test('a failed program restores the rendered viewport and discards its source replacement', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	const manager = await openManager(page, editor);
	await newProgram(manager, [
		'const tracks = await sound.project.tracks();',
		'await sound.view.set({ pixelsPerSecond: 2000, scrollX: 240, scrollY: 180,',
		'  tracks: tracks.map(track => ({ id: track.id, height: 700 })) });',
	].join('\n'));
	await run(manager);
	const failingSource = [
		'const tracks = await sound.project.tracks();',
		'await sound.view.set({ pixelsPerSecond: 4000, scrollX: 900, scrollY: 0,',
		'  tracks: tracks.map(track => ({ id: track.id, height: 350 })) });',
		'await sound.self.replaceSource("sound.log.info(99);");',
		'throw new Error("View rollback witness");',
	].join('\n');
	await manager.locator('[data-macro-script-source]').fill(failingSource);
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'failed');
	await expect(manager.locator('[data-macro-script-failure]')).toContainText('View rollback witness');
	await expect(manager.locator('[data-macro-script-source]')).toHaveValue(failingSource);
	await expect(editor.locator('[data-timeline]')).toHaveJSProperty('scrollLeft', 240);
	await expect(editor.locator('[data-timeline]')).toHaveJSProperty('scrollTop', 180);
	await expect(editor.locator('[data-track-row][data-track-id]').first()).toHaveCSS('height', '700px');
});
