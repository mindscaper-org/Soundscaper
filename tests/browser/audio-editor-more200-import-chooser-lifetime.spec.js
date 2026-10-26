/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';

for (const handoff of [false, true]) test(`File Import chooser belongs to its initiating project, OS handoff=${String(handoff)}`, async ({ page }) => {
	const exported = await createSoundscaperScapeNativeRuntime().exportScapeProject(createSoundscaperProject({ id: 'chooser-incoming', title: 'Incoming' }), {
		async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); },
	});
	expect(exported.blob).toBeInstanceOf(Blob); const incoming = Buffer.from(await exported.blob.arrayBuffer()).toString('base64');
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', { configurable: true,
		value: { setConsumer(consumer) { globalThis.__importChooserLaunch = consumer; } } }));
	const editor = await bootEditor(page, '/embed/en/'); const choosing = page.waitForEvent('filechooser');
	await chooseCommandAction(page, editor, 'File', 'Import'); const outgoing = await choosing;
	if (handoff) {
		await page.evaluate(base64 => {
			const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
			globalThis.__importChooserLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([bytes], 'Incoming.sscape', { type: 'application/x-scape-project' })) }] });
		}, incoming);
		await expect(editor).toHaveAttribute('data-project-id', 'chooser-incoming'); await waitForProjectActivation(editor);
	}
	const oldFile = createWavFixture({ name: 'Outgoing choice.wav', duration: .1 }); await outgoing.setFiles(oldFile);
	if (!handoff) { await expect(clipByName(editor, oldFile.name)).toBeVisible(); await expect(editor).not.toHaveAttribute('data-edit-block-reason'); }
	const choosingFresh = page.waitForEvent('filechooser'); await chooseCommandAction(page, editor, 'File', 'Import');
	const freshFile = createWavFixture({ name: 'Fresh choice.wav', duration: .1 }); await (await choosingFresh).setFiles(freshFile);
	await expect(clipByName(editor, freshFile.name)).toBeVisible(); await expect(editor).not.toHaveAttribute('data-edit-block-reason');
	await expect(editor).toHaveAttribute('data-clip-count', handoff ? '1' : '2');
	if (handoff) await expect(clipByName(editor, oldFile.name)).toHaveCount(0);
});
