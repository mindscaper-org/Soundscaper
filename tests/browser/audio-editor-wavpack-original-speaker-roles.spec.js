/* SPDX-License-Identifier: AGPL-3.0-only */
import { WAVPACK_SPEAKER_ROLE_RECORDINGS } from '../helpers/wavpack-speaker-role-fixture.ts';
import { nativeOriginalImportFixture } from '../helpers/native-original-import-fixture.ts';
import { installNativeOriginalBridge } from './helpers/native-original-import-bridge.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, openNestedCommandMenu } from './audio-editor-test-helpers.js';

for (const name of ['Back stereo', 'Front stereo']) test(`native Original WavPack protects ${name} speaker roles`, async ({ page }) => {
	const recording = WAVPACK_SPEAKER_ROLE_RECORDINGS.find(value => value.name === name);
	expect(recording).toBeTruthy();
	const input = Uint8Array.from(Buffer.from(recording.base64, 'base64'));
	const file = new File([input], `${name}.wv`, { type: 'audio/wavpack' });
	const native = await nativeOriginalImportFixture(file);
	try {
		await installNativeOriginalBridge(page, native);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await chooseFileAction(page, editor, 'Import');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		const menu = await openNestedCommandMenu(page, editor, 'File', []);
		if (recording.available) {
			await expect(menu.getByRole('menuitem', { name: `Overwrite ${name}.wv`, exact: true })).toBeEnabled();
		} else {
			await expect(menu.getByRole('menuitem', { name: 'Overwrite original file', exact: true })).toBeDisabled();
		}
		expect(native.prepared).toHaveLength(0);
		expect(native.completed).toHaveLength(0);
		expect(new Uint8Array(await native.savedBytes())).toEqual(input);
	} finally { await native.close(); }
});
