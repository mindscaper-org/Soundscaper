/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, openEffectsForTrack, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';

async function projectFile(id, mix) {
	const source = createAudioSource({ id: `${id}-source`, frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'], effects: [{ id: 'shared-effect', type: 'delay', enabled: true, params: { time: .1, feedback: .2, mix } }] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		return Buffer.from(await archive.blob.arrayBuffer()).toString('base64');
	} finally { await store.close(); }
}
async function launch(page, content) {
	await page.evaluate(({ content, type }) => {
		const bytes = Uint8Array.from(atob(content), character => character.charCodeAt(0));
		globalThis.__nextEffectDraftLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([bytes], 'Recording.sscape', { type })) }] });
	}, { content, type: SCAPE_MIME_TYPE });
}

for (const owner of ['selection', 'rack']) test(`${owner} numeric draft cannot enter an OS-opened project with reused effect identities`, async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__nextEffectDraftLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/en/');
	await launch(page, await projectFile(`effect-${owner}-outgoing`, .3));
	await expect(editor).toHaveAttribute('data-project-id', `effect-${owner}-outgoing`); await waitForProjectActivation(editor);
	let field, before;
	if (owner === 'selection') {
		await editor.locator('[data-clip-id="clip"]').press('Enter');
		await expect(editor.locator('[data-clip-id="clip"] .clip-display')).toHaveAttribute('data-selected', 'true');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
		field = page.locator('[data-selection-effects-dialog] [data-effect-param="gainDb"] input[type="number"]');
		await expect(field).not.toHaveValue('0'); before = await field.inputValue();
		await field.fill('5');
	} else {
		const panel = await openEffectsForTrack(editor, 0);
		await panel.locator('[data-effect-rack]').first().getByRole('button', { name: 'Select effect', exact: true }).first().click();
		field = page.locator('[data-effect="shared-effect"] [data-effect-param="mix"] input[type="number"]');
		await expect(field).toHaveValue('0.3'); await field.fill('0.6');
	}
	await expect(field).toBeFocused();
	await launch(page, await projectFile(`effect-${owner}-incoming`, .9));
	await expect(editor).toHaveAttribute('data-project-id', `effect-${owner}-incoming`); await waitForProjectActivation(editor);
	if (owner === 'selection') {
		await expect(field).toHaveValue(before);
		await field.press('Tab');
		await expect(page.locator('[data-selection-effects-dialog] [data-effect-param="gainDb"]').getByRole('slider')).not.toHaveValue('5');
	} else {
		await expect(page.locator('[data-effect="shared-effect"]')).toHaveCount(0);
		const panel = await openEffectsForTrack(editor, 0);
		await panel.locator('[data-effect-rack]').first().getByRole('button', { name: 'Select effect', exact: true }).first().click();
		await expect(field).toHaveValue('0.9');
	}
});
