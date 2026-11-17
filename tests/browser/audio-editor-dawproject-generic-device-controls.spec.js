/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { dawprojectGenericDeviceXml, indexedHighPassDevice } from '../helpers/dawproject-generic-device-fixture.ts';

test('DAWproject File Import plays an indexed high-pass band', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const pcm = Uint8Array.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true }));
	const archive = await writeDawprojectArchive({
		projectXml: dawprojectGenericDeviceXml(indexedHighPassDevice),
		metadataXml: '<MetaData/>', files: [{ path: 'voice.wav', blob: new Blob([pcm]) }],
	});
	await importFiles(editor, [{ name: 'Device.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await waitForProjectActivation(editor);
	const samples = (await exportSamples(page, editor)).slice(12000, 24000);
	const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
	expect(rms).toBeLessThan(.001);
});
