/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clickClipInterior, clipByName, importFiles } from './audio-editor-test-helpers.js';

// Node runs each semantic variant through the real controller and archive.
// Keep actual palette/worker runs in one editor, with independent header and pointer selections.
test('macro programs retain header-relative, omitted-edge and cursor meanings in the palette', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clickClipInterior(page, clip, .5);
	const cursor = Number(await editor.getByRole('slider', { name: 'Playhead', exact: true }).getAttribute('aria-valuenow'));
	expect(cursor).toBeGreaterThan(0);
	await clip.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	const manager = page.getByRole('dialog', { name: 'Macro manager', exact: true });
	await manager.getByLabel('New program', { exact: true }).click();
	// Selection commands may move the playhead. Exercise the cursor commands
	// before any other program changes the independent pointer-authored cursor.
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill([
		`await sound.select.time(${cursor / 48_000}, ${cursor / 48_000});`,
		"await sound.command('SelTrackStartToCursor');",
		'const trackStart = await sound.project.selection();',
		"sound.log.info('range ' + trackStart.startFrame + '-' + trackStart.endFrame);",
		`await sound.select.time(${cursor / 48_000}, ${cursor / 48_000});`,
		"try { await sound.command('SelCursorStoredCursor'); } catch (error) { sound.log.info('stored cursor refused'); }",
		'const stored = await sound.project.selection();',
		"sound.log.info('range ' + stored.startFrame + '-' + stored.endFrame);",
	].join('\n'));
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	for (const line of [`range 0-${cursor}`, `range ${cursor}-${cursor}`, 'stored cursor refused']) await expect(log).toContainText(line);
	await expect(manager.locator('[data-macro-script-failure]')).toHaveCount(0);
	await manager.getByRole('button', { name: 'Close', exact: true }).click();

	// Restore a real clip-header selection for the separate header-read program.
	await clip.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tools', 'Macro manager');
	await manager.getByLabel('New program', { exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill([
		'const selected = await sound.project.selection();',
		"sound.log.info('Selection frames ' + selected.startFrame + '..' + selected.endFrame);",
		"const relative = await sound.select.time(.2, 0, { relativeTo: 'selection-end' });",
		"sound.log.info('Relative selection frames ' + relative.startFrame + '..' + relative.endFrame);",
		'await sound.select.frames(0, 38400);',
		"const omitted = await sound.command('SelectTime', { start: .2 });",
		"sound.log.info('Selection frames ' + omitted.startFrame + '..' + omitted.endFrame);",
		'await sound.select.all();',
		"await sound.select.tracks({ track: 0, trackCount: 100, mode: 'remove' });",
		'const empty = await sound.project.selection();',
		"sound.log.info('selected tracks=' + empty.trackIds.length);",
		"sound.log.info('range=' + empty.startFrame + '-' + empty.endFrame);",
		"try { await sound.command('Delete'); } catch (error) { sound.log.info('empty selection refused'); }",
		"console.log('Run started:', Date());",
		"sound.assert(Date() === new Date(Date.now()).toString(), 'Use the virtual clock');",
		"console.log('Date call completed');",
	].join('\n'));
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	for (const line of ['Selection frames 0..38400', 'Relative selection frames 28800..38400',
		'Selection frames 9600..38400', 'selected tracks=0', 'range=0-38400', 'Date call completed']) await expect(log).toContainText(line);
	await expect(manager.locator('[data-macro-script-failure]')).toHaveCount(0);
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
