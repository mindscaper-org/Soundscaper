/* SPDX-License-Identifier: AGPL-3.0-only */

// Offline authoring command; never called during a test or a product build.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage();
	const photos = await Promise.all(['astronaut.png', 'chelsea.png'].map(async name =>
		(await readFile(new URL(`./fixtures/${name}`, import.meta.url))).toString('base64')));
	const bytes = await page.evaluate(async sources => {
		const images = await Promise.all(sources.map(async source => {
			const image = new Image(); image.src = `data:image/png;base64,${source}`;
			await image.decode(); return image;
		}));
		const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
		const context = canvas.getContext('2d');
		const stream = canvas.captureStream(2);
		const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 300_000 });
		const chunks = [];
		const stopped = new Promise(resolve => { recorder.onstop = resolve; });
		recorder.ondataavailable = event => chunks.push(event.data);
		recorder.start();
		for (let frame = 0; frame < 64; frame += 1) {
			const image = images[Math.floor(frame / 16) % images.length];
			context.fillStyle = 'white'; context.fillRect(0, 0, 512, 512);
			const scale = Math.min(512 / image.width, 512 / image.height);
			context.drawImage(image, (512 - image.width * scale) / 2, (512 - image.height * scale) / 2,
				image.width * scale, image.height * scale);
			context.fillStyle = 'white'; context.fillRect(0, 448, 512, 64);
			context.fillStyle = 'black'; context.font = 'bold 40px sans-serif'; context.textAlign = 'center';
			context.fillText('LOCAL MODEL TEST', 256, 493);
			await new Promise(resolve => setTimeout(resolve, 500));
		}
		recorder.stop(); await stopped;
		for (const track of stream.getTracks()) track.stop();
		return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
	}, photos);
	await writeFile(new URL('./fixtures/editor-workflows.webm', import.meta.url), Buffer.from(bytes));
	process.stdout.write(`Authored with Chromium ${browser.version()}: ${String(bytes.length)} bytes\n`);
} finally { await browser.close(); }
