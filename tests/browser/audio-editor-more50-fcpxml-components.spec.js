/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openClipProperties, clipByName, closeClipProperties } from './audio-editor-test-helpers.js';
import { readClipGain } from './audio-editor-clip-settings-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';

test('Import retains secondary-storyline cuts and keeps a disabled audio component silent', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const xml = '<fcpxml version="1.7"><resources><format id="f" frameDuration="1/25s"/>'
		+ '<asset id="a" name="Programme" src="programme.wav" duration="2s" hasAudio="1" hasVideo="0"/></resources>'
		+ '<project name="Secondary storyline"><sequence format="f" duration="2s"><spine><gap duration="2s"><spine lane="-1" offset="0s">'
		+ '<asset-clip ref="a" name="Disabled component" duration="1s"><audio-channel-source srcCh="1" enabled="0"/></asset-clip>'
		+ '<asset-clip ref="a" name="Audible cut" offset="1s" duration="1s"/></spine></gap></spine></sequence></project></fcpxml>';
	await importFiles(editor, [{ name: 'secondary.fcpxml', mimeType: 'application/xml', buffer: Buffer.from(xml) },
		{ name: 'programme.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(96_000).fill(.25)], { sampleRate: 48_000, float: true })) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	for (const [name, silent] of [['Disabled component', true], ['Audible cut', false]]) {
		const properties = await openClipProperties(page, editor, clipByName(editor, name));
		const gain = await readClipGain(properties);
		expect(gain).toBe(silent ? -60 : 0);
		await closeClipProperties(properties);
	}
});
