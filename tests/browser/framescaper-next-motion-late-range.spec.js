/* SPDX-License-Identifier: AGPL-3.0-only */

import { BufferSource, BufferTarget, EncodedPacket, EncodedPacketSink, EncodedVideoPacketSource, Input, Output, WEBM, WebMOutputFormat } from 'mediabunny';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

async function longVideo() {
	const input = new Input({ formats: [WEBM], source: new BufferSource(createDeterministicSilentVideoFixture('key.webm').buffer) });
	try {
		const track = await input.getPrimaryVideoTrack(); expect(track).not.toBeNull();
		const packet = await new EncodedPacketSink(track).getFirstKeyPacket(); expect(packet).not.toBeNull();
		const config = await track.getDecoderConfig();
		const target = new BufferTarget(); const output = new Output({ format: new WebMOutputFormat(), target });
		const video = new EncodedVideoPacketSource('vp8'); output.addVideoTrack(video, { frameRate: 15 });
		await output.start();
		for (let frame = 0; frame < 6_100; frame++) await video.add(new EncodedPacket(packet.data, 'key', frame / 15, 1 / 15), frame === 0 ? { decoderConfig: config } : undefined);
		await output.finalize(); expect(target.buffer).not.toBeNull();
		return { name: 'long-camera.webm', mimeType: 'video/webm', buffer: Buffer.from(target.buffer) };
	} finally { input.dispose(); }
}

test('Motion Tracking analyzes a bounded window beyond source frame4096', async ({ page }) => {
	test.setTimeout(120_000);
	const file = await longVideo();
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	// Import authenticates the timing index of all 6,100 source frames first.
	await importFiles(editor, [file], { timeout: 90_000 });
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Managed Color & Source Interpretation']);
	const color = page.getByRole('dialog', { name: 'Managed Color & Source Interpretation', exact: true });
	const sourceId = JSON.parse(await color.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue()).videoSourceColorInterpretations[0].sourceId;
	await color.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Analyze', 'Motion Tracking');
	const dialog = page.getByRole('dialog', { name: 'Motion Tracking', exact: true });
	const document = dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true });
	const state = JSON.parse(await document.inputValue());
	state.videoProcessorStacks = [{ schemaVersion: 1, id: 'late-stack', sourceId, processors: [{
		schemaVersion: 1, id: 'tracking', kind: 'tracking', enabled: true, maximumFeatures: 32,
		quality: 0.01, minimumDistance: 2, windowRadius: 2, pyramidLevels: 2,
	}] }];
	await document.fill(JSON.stringify(state)); await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Finishing state updated.');
	for (const [label, frame] of [['End frame', 6_002], ['Start frame', 6_000]]) {
		const field = dialog.getByRole('group', { name: label, exact: true });
		await field.getByRole('button', { name: `${label}: format`, exact: true }).click();
		await page.getByRole('menuitem', { name: /^Video frames/u }).hover();
		await page.getByRole('menuitem', { name: /^film frames/u }).click();
		await field.locator('.timecode-digit').first().click(); await page.keyboard.type(String(frame).padStart(12, '0')); await page.keyboard.press('Enter');
		await expect(field.locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
	}
	await dialog.getByRole('button', { name: 'Analyze motion', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Motion analysis published and current.', { timeout: 30_000 });
	const saved = JSON.parse(await document.inputValue()).videoMotionAnalyses[0];
	expect([saved.startFrame, saved.endFrame]).toEqual([6_000, 6_002]);
});
