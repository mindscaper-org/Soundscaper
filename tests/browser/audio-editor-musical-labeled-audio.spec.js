/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const musical of [true]) test(`Labeled Audio splits an opened ${musical ? 'musical' : 'sample'} label at its audible boundaries`, async ({ page }) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	let archive;
	try {
		const label = { id: 'span', title: 'Middle', ...(musical
			? { anchor: 'musical', startBeat: { num: 1, den: 1 }, endBeat: { num: 2, den: 1 } }
			: { startFrame: 24_000, endFrame: 48_000 }) };
		const project = createSoundscaperProject({ id: `musical-labeled-${musical}`, sampleRate: 48_000,
			tempoMap: { mode: 'musical', events: [{ id: 'origin', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
			tracks: [{ id: 'labels', type: 'label', name: 'Cues', labels: [label] }] });
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Labeled music.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', `musical-labeled-${musical}`);
	await importFiles(editor, [createWavFixture({ name: 'label-bed.wav', frequency: 330, duration: 2 })]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const menu = await openNestedCommandMenu(page, editor, 'Edit', ['Labeled audio']);
	const split = menu.getByRole('menuitem', { name: /^Split(?:\s|$)/u });
	await expect(split).toBeEnabled();
	await split.click();
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '3');
});
