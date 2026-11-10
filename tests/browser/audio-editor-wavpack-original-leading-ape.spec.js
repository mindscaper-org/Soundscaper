/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { createApeFileMetadata } from '../../src/common/editor/ape-file-metadata.ts';
import { nativeOriginalImportFixture } from '../helpers/native-original-import-fixture.ts';
import { withWavPackTotalFrames } from '../helpers/wavpack-import-fixture.ts';
import { installNativeOriginalBridge } from './helpers/native-original-import-bridge.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, openNestedCommandMenu } from './audio-editor-test-helpers.js';

test('native File Import keeps Original WavPack available past leading APEv2', async ({ page }) => {
	const pcm = Float32Array.from({ length: 4800 }, (_value, index) => Math.sin(index / 30) / 4);
	const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		channelCount: 1, sampleRate: 48_000, settings: { compressionLevel: 2 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	const file = new File([createApeFileMetadata({ title: 'Archived performance' }), withWavPackTotalFrames(encoded, pcm.length)],
		'Archived performance.wv', { type: 'audio/wavpack' });
	const native = await nativeOriginalImportFixture(file);
	try {
		await installNativeOriginalBridge(page, native);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await chooseFileAction(page, editor, 'Import');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		const menu = await openNestedCommandMenu(page, editor, 'File', []);
		await expect(menu.getByRole('menuitem', { name: 'Overwrite Archived performance.wv', exact: true })).toBeEnabled();
	} finally { await native.close(); }
});
