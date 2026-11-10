/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { gappedOpusMp4Fixture } from '../helpers/gapped-opus-mp4-fixture.ts';
import { nativeOpusMp4Fixture } from '../helpers/native-opus-mp4-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test('Opus MP4 File Import and native Save retain origin, packet gaps and programme tails', async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const kinds = ['origin', 'ordinary', 'subpacket'];
	const fixtures = kinds.map(kind => ({ kind, ...(kind === 'origin' ? nativeOpusMp4Fixture() : gappedOpusMp4Fixture(kind)) }));
	for (const [index, { kind, file }] of fixtures.entries()) {
		await editor.locator('[data-import-input]').setInputFiles({ name: `${kind}.m4a`, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-clip-count', String(index + 1), { timeout: 15_000 });
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	}
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources).toHaveLength(3);
	for (const { kind, reference } of fixtures) {
		const source = project.sources.find(source => source.name === `${kind}.m4a`);
		expect(source).toMatchObject({ sampleRate: 48_000, frameCount: reference.length, channelCount: 1 });
		const pcm = Buffer.from(entries[`audio/${source.id}.f32c`]); let maximumError = 0, tailPeak = 0;
		for (let frame = 0; frame < reference.length; frame++) {
			const value = pcm.readFloatLE(4 + frame * 4); maximumError = Math.max(maximumError, Math.abs(value - reference[frame]));
			if (kind === 'ordinary' && frame >= 6240 && frame < 8640) expect(value).toBe(0);
			if (frame >= reference.length - 1920) tailPeak = Math.max(tailPeak, Math.abs(value));
		}
		expect(maximumError).toBeLessThan(1e-7); expect(tailPeak).toBeGreaterThan(.08);
	}
	await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
});
