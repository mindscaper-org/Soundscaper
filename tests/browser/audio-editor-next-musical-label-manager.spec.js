/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

test('Manage labels shows and selects the resolved range from an opened musical-label file', async ({ page }) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	let archive;
	try {
		const project = createSoundscaperProject({ id: 'musical-manager-file', sampleRate: 48_000,
			tempoMap: { mode: 'musical', events: [
				{ id: 'head', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ id: 'change', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
			] }, tracks: [{ id: 'labels', type: 'label', name: 'Cues', labels: [
				{ id: 'span', title: 'Across change', anchor: 'musical', startBeat: { num: 3, den: 1 }, endBeat: { num: 5, den: 1 } },
			] }] });
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Musical cues.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'musical-manager-file');
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	await expect(panel.locator('.timecode__display').nth(0)).toHaveText('00h00m01.500s');
	await expect(panel.locator('.timecode__display').nth(1)).toHaveText('00h00m03.000s');
	await panel.getByRole('button', { name: 'Time selection', exact: true }).click();
	await expect(editor.getByRole('group', { name: 'Selection start', exact: true }).last().locator('.timecode__display')).toHaveText('00h00m01.500s');
	await expect(editor.getByRole('group', { name: 'Selection end', exact: true }).last().locator('.timecode__display')).toHaveText('00h00m03.000s');
});
