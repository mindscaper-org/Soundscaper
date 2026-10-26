/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { oversizedVideoAudioFixture } from '../helpers/oversized-video-audio-fixture.ts';
import { unequalAvPreviewFixture } from '../helpers/unequal-av-preview-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test.afterEach(async ({ page }, testInfo) => {
	await testInfo.attach('native-workload.json', { body: JSON.stringify(await page.evaluate(() => ({
		native: globalThis.__workloadNative, metadata: globalThis.__workloadMetadata,
		pictureCapability: globalThis.__workloadPictureCapability,
		editor: document.querySelector('[data-audio-editor]')?.dataset,
		messages: [...document.querySelectorAll('[role="status"], [role="alert"]')].map(value => value.textContent?.slice(0, 500)),
		videos: [...document.querySelectorAll('video')].map(video => ({
			currentTime: video.currentTime, readyState: video.readyState, seeking: video.seeking,
			width: video.videoWidth, height: video.videoHeight, duration: video.duration,
		})),
	}))), contentType: 'application/json' });
});

for (const oversized of [false, true]) test(`video import bounds native decoded audio before allocation: oversized=${oversized}`, async ({ page }) => {
	test.setTimeout(90_000); await disableNativeSavePicker(page);
	const file = oversized ? oversizedVideoAudioFixture() : unequalAvPreviewFixture(2), original = Buffer.from(await file.arrayBuffer());
	await page.addInitScript(({ length, oversized }) => {
		const decode = BaseAudioContext.prototype.decodeAudioData;
		globalThis.__workloadNative = []; globalThis.__workloadMetadata = [];
		const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
		Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...currentTime, set(value) {
			if (this instanceof HTMLVideoElement) globalThis.__workloadMetadata.push({ event: 'requested-seek', time: performance.now(), currentTime: value });
			currentTime.set.call(this, value);
		} });
		const recordMediaEvent = event => {
			if (event.target instanceof HTMLVideoElement) globalThis.__workloadMetadata.push({
				event: event.type, time: performance.now(), currentTime: event.target.currentTime,
				readyState: event.target.readyState, seeking: event.target.seeking,
				width: event.target.videoWidth, height: event.target.videoHeight, duration: event.target.duration,
			});
		};
		for (const event of ['loadstart', 'loadedmetadata', 'loadeddata', 'seeking', 'seeked', 'error']) document.addEventListener(event, recordMediaEvent, true);
		BaseAudioContext.prototype.decodeAudioData = function (encoded, ...rest) {
			if (encoded.byteLength !== length) return decode.call(this, encoded, ...rest);
			const record = { nativeContext: this instanceof BaseAudioContext, rate: this.sampleRate, bytes: encoded.byteLength };
			globalThis.__workloadNative.push(record);
			// Prevent the original unsafe owner from allocating900s of PCM or falling through to another whole decoder.
			if (oversized) return new Promise(() => {});
			return decode.call(this, encoded, ...rest).then(buffer => {
				record.nativeBuffer = buffer instanceof AudioBuffer; record.channels = buffer.numberOfChannels; record.frames = buffer.length;
				globalThis.__workloadHealthyBuffer = buffer; return buffer;
			});
		};
	}, { length: original.length, oversized });
	const ffmpegRequests = []; page.on('request', request => { if (/\/runtime\/ffmpeg\//u.test(request.url())) ffmpegRequests.push(request.url()); });
	const editor = await bootEditor(page, '/embed/en/');
	let pictureCapability = null;
	if (oversized) {
		await page.evaluate(() => {
			const input = document.createElement('input'); input.type = 'file'; input.id = 'workload-native-probe'; input.hidden = true; document.body.append(input);
		});
		await page.locator('#workload-native-probe').setInputFiles({ name: file.name, mimeType: file.type, buffer: original });
		pictureCapability = await page.evaluate(async () => {
			const input = document.querySelector('#workload-native-probe'), file = input.files[0], video = document.createElement('video');
			const url = URL.createObjectURL(file); video.preload = 'metadata'; video.muted = true;
			try {
				const result = await new Promise((resolve, reject) => {
					const finish = callback => { clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; callback(); };
					const timer = setTimeout(() => finish(() => reject(new Error('Independent native metadata did not settle.'))), 15_000);
					video.onloadedmetadata = () => finish(() => resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration, byteLength: file.size }));
					video.onerror = () => finish(() => reject(new Error('Independent native metadata was refused.')));
					video.src = url;
				});
				globalThis.__workloadPictureCapability = result; return result;
			} finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); input.remove(); }
		});
		expect(pictureCapability.byteLength).toBe(original.length); expect(pictureCapability.duration).toBe(900);
	}
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: original });
	if (pictureCapability?.width === 0 && pictureCapability.height === 0) {
		await expect.poll(() => page.evaluate(() => globalThis.__workloadMetadata.some(value => value.event === 'loadedmetadata' && value.width === 0 && value.height === 0))).toBe(true);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		expect(await page.evaluate(() => globalThis.__workloadNative.length)).toBe(0); expect(ffmpegRequests).toHaveLength(0);
		const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
		expect(project.sources).toHaveLength(0); expect(project.clips).toHaveLength(0); return;
	}
	if (pictureCapability) expect(pictureCapability).toMatchObject({ width: 64, height: 32 });
	if (oversized) {
		await expect.poll(() => page.evaluate(() => globalThis.__workloadNative.length > 0
			|| document.querySelector('[data-audio-editor]').dataset.clipCount === '1'), { timeout: 60_000 }).toBe(true);
		expect(await page.evaluate(() => globalThis.__workloadNative.length)).toBe(0);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor).toContainText('The video was imported without audio.');
		expect(ffmpegRequests).toHaveLength(0);
	} else {
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
		expect(await page.evaluate(() => globalThis.__workloadNative)).toMatchObject([{ nativeContext: true, nativeBuffer: true, rate: 48_000, channels: 1 }]);
	}
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const image = editor.locator('.audio-editor-video-clip__filmstrip img').first();
	await expect.poll(() => image.evaluate(value => value.complete && value.naturalWidth === 64)).toBe(true);
	const pixel = await image.evaluate(value => {
		const canvas = document.createElement('canvas'); canvas.width = value.naturalWidth; canvas.height = value.naturalHeight;
		const context = canvas.getContext('2d'); context.drawImage(value, 0, 0); return [...context.getImageData(32, 16, 1, 1).data];
	});
	expect(pixel[0]).toBeLessThan(40); expect(pixel[1]).toBeGreaterThan(60); expect(pixel[1]).toBeLessThan(100);
	expect(pixel[2]).toBeGreaterThan(200); expect(pixel[3]).toBe(255);
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	const video = project.sources.find(source => source.kind === 'video'), audios = project.sources.filter(source => source.kind === 'audio');
	expect(video).toMatchObject({ sourceFrameCount: 60, width: 64, height: 32, sampleFrameCount: 96_000 });
	expect(Buffer.from(entries[`media/${video.id}/original`]).equals(original)).toBe(true);
	if (oversized) expect(audios).toHaveLength(0);
	else {
		expect(audios).toHaveLength(1); const audio = audios[0];
		expect(audio).toMatchObject({ sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
		const pcm = Buffer.from(entries[`audio/${audio.id}.f32c`]);
		expect(pcm.byteLength).toBe(Math.ceil(audio.frameCount / audio.chunkFrames) * 4 + audio.frameCount * 4);
		const reference = await page.evaluate(() => [...globalThis.__workloadHealthyBuffer.getChannelData(0)]);
		expect(reference.length).toBeGreaterThanOrEqual(audio.frameCount); let error = 0, peak = 0, finite = true;
		let offset = 0, written = 0;
		while (written < audio.frameCount) {
			const count = pcm.readUInt32LE(offset); expect(count).toBe(Math.min(audio.chunkFrames, audio.frameCount - written)); offset += 4;
			for (let frame = 0; frame < count; frame++) {
				const value = pcm.readFloatLE(offset + frame * 4); finite &&= Number.isFinite(value);
				error = Math.max(error, Math.abs(value - reference[written + frame])); peak = Math.max(peak, Math.abs(value));
			}
			offset += count * 4; written += count;
		}
		expect(offset).toBe(pcm.byteLength);
		expect(finite).toBe(true); expect(error).toBeLessThan(1e-7); expect(peak).toBeGreaterThan(.05);
	}
});
