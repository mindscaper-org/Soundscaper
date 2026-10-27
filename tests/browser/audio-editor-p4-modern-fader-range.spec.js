/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAup3Fixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import initSqlJs from 'sql.js';
import { audacityXmlChildren, decodeAudacityBinaryXml, encodeAudacityBinaryXml } from '../../src/common/editor/audacity-binary-xml.js';
import { createAup4EffectsNode } from '../../src/common/editor/aup4-effects.js';
import { createEffect } from '../../src/common/editor/effects.js';

for (const gain of [8, 10 ** (36 / 20), 4]) test(`native AUP3 fader gain ${gain} retains its authored WAV level`, async ({ page }) => {
	test.setTimeout(90_000);
	const frames = 4800;
	const bytes = await createAup3Fixture({ sampleRate: 48_000, tracks: [{ name: 'Voice', gain,
		clips: [{ samples: Array(frames).fill(.002) }] }] });
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const chooser = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: 'Fader gain.aup3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1'); await waitForProjectActivation(editor);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const saved = await persistedProject(page, projectId);
	const rendered = await exportSamples(page, editor);
	expect(rendered).toHaveLength(frames); expect(rendered[1000]).toBeCloseTo(.002 * gain / Math.SQRT2, 5);
	expect(saved.tracks.find(track => track.type === 'audio').gain * saved.clips[0].gain).toBeCloseTo(gain, 12);
	await page.reload(); await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
	const reopened = await exportSamples(page, editor);
	expect(reopened).toHaveLength(frames); expect(reopened[1000]).toBeCloseTo(rendered[1000], 6);
});

test('an unrepresentable high post-rack fader refuses without replacing the workspace and permits an ordinary rack retry', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const originalId = await editor.getAttribute('data-project-id');
	await openRack(8);
	await expect(editor.locator('[data-editor-toast="workspace-error"]')).toContainText('This Audacity project uses an unsupported or unsafe database format.', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-project-id', originalId);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await openRack(4);
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1'); await waitForProjectActivation(editor);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const saved = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(saved.tracks.find(track => track.type === 'audio').effects[0].type).toBe('audacity-distortion');
	expect(saved.tracks.find(track => track.type === 'audio').gain).toBe(4);
	expect(saved.clips[0].gain).toBe(1);
	expect(await exportSamples(page, editor)).toHaveLength(4800);

	async function openRack(gain) {
		const SQL = await initSqlJs();
		const database = new SQL.Database(await createAup3Fixture({ SQL, tracks: [{ name: 'Voice', gain,
			clips: [{ samples: Array(4800).fill(.002) }] }] }));
		let bytes;
		try {
			const [dictionary, document] = database.exec('SELECT dict, doc FROM project WHERE id = 1')[0].values[0];
			const root = decodeAudacityBinaryXml(dictionary, document).root;
			audacityXmlChildren(root, 'wavetrack')[0].content.push({ kind: 'node', node: createAup4EffectsNode([createEffect('audacity-distortion')]) });
			const encoded = encodeAudacityBinaryXml(root);
			database.run('UPDATE project SET dict = ?, doc = ? WHERE id = 1', [encoded.dictionary, encoded.document]);
			bytes = database.export();
		} finally { database.close(); }
		const chooser = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
		await (await chooser).setFiles({ name: 'Post-rack fader.aup3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
	}
});
