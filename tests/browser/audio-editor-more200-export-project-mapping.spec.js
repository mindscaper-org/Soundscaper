/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openExportDialog, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';

test('OS File Open retires the outgoing export channel mapping draft', async ({ page }) => {
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(
		createSoundscaperProject({ id: 'more200-mapping-incoming', masterChannels: 6 }), {
			async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
			readSourceChunks() { return (async function* empty() {})(); },
		});
	expect(archive.blob).toBeInstanceOf(Blob);
	const incoming = Buffer.from(await archive.blob.arrayBuffer()).toString('base64');
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__more200MappingLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Outgoing stereo.wav', duration: .1, channelCount: 2 })]);
	const dialog = await openExportDialog(page, editor);
	await dialog.locator('[data-export-channel-option="custom"] input').check();
	await dialog.getByRole('button', { name: 'Edit mapping', exact: true }).click();
	const mapping = page.locator('[data-export-channel-mapping]');
	await expect(mapping).toBeVisible();
	await mapping.locator('[data-export-channel-mapping-cell="0-0"]').getByRole('checkbox').click();
	await page.evaluate(base64 => {
		const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
		globalThis.__more200MappingLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(
			new File([bytes], 'Incoming.sscape', { type: 'application/x-scape-project' }),
		) }] });
	}, incoming);
	await expect(editor).toHaveAttribute('data-project-id', 'more200-mapping-incoming');
	await waitForProjectActivation(editor);
	await expect(mapping).toHaveCount(0);
	await expect(dialog.locator('[data-export-channel-option="preserve"] input')).toBeChecked();
});
