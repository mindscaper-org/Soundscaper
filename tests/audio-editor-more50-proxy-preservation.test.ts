/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createFfmpegVideoProxyGenerator } from '../src/common/editor/video-proxy-ffmpeg-generator.ts';
import { VIDEO_PROXY_GENERATION_RECIPE } from '../src/common/editor/video-proxy-generation.ts';
import { demuxVideoTiming } from '../src/common/editor/video-timing-demux.ts';
import { readContainerVideoSourceCharacteristics } from '../src/common/editor/video-container-characteristics.ts';
import { videoRetimePreviewMedia } from './browser/fixtures/video-retime-preview-media.js';
import type { FfmpegMediaFileLease } from '../src/common/editor/ffmpeg-media-file-operation.ts';

interface Core {
	FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void };
	exec(...args: string[]): number;
	reset(): void;
	setLogger(listener: (entry: { message: string }) => void): void;
}
const identity = { authority: 'owned' as const, projectId: 'p', sourceId: 's', storageKey: 's', mimeType: 'video/mp4', byteLength: 1, sha256: 'a'.repeat(64), generationToken: 'g' };
const current = { assertCurrent() {} };

async function generate(core: Core, original: Blob): Promise<Blob> {
	const logs: string[] = [];
	core.setLogger(({ message }) => logs.push(message));
	const lease: FfmpegMediaFileLease = {
		writeInput(bytes) { core.FS.writeFile('original', bytes); return Promise.resolve('original'); },
		writeText: () => Promise.resolve(),
		exec(args) { core.reset(); return Promise.resolve({ exitCode: core.exec(...args), logs }); },
		readOutput(path) { return Promise.resolve(core.FS.readFile(path)); },
		deletePath(path) { core.FS.unlink(path); return Promise.resolve(); },
	};
	const generator = createFfmpegVideoProxyGenerator({ runOperation: operation => operation(lease) });
	const candidate = await generator.generate(original, identity, VIDEO_PROXY_GENERATION_RECIPE, current);
	assert.ok(candidate instanceof Blob);
	return candidate;
}

test('generated proxies preserve anamorphic display geometry, VFR boundaries and tiny pictures', async () => {
	const previousSelf: unknown = Reflect.get(globalThis, 'self');
	const previousLocation: unknown = Reflect.get(globalThis, 'location');
	Reflect.set(globalThis, 'self', globalThis);
	Reflect.set(globalThis, 'location', { href: import.meta.url });
	try {
		const moduleName = '@ffmpeg/core';
		const { default: createCore } = await import(moduleName) as { default(options: { wasmBinary: Uint8Array }): Promise<Core> };
		const core = await createCore({ wasmBinary: await readFile(new URL('../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url)) });
		core.setLogger(() => {});
		assert.equal(core.exec('-f', 'lavfi', '-i', 'color=red:s=720x480:r=25:d=0.08', '-vf', 'setsar=40/33', '-c:v', 'libx264', 'anamorphic.mp4'), 0);
		const anamorphic = await generate(core, new Blob([Uint8Array.from(core.FS.readFile('anamorphic.mp4'))]));
		const geometry = await readContainerVideoSourceCharacteristics(anamorphic);
		assert.equal(geometry.codedHeight, 480);
		assert.ok(Math.abs(geometry.codedWidth! / geometry.codedHeight! - 720 / 480 * 40 / 33) < 0.005, 'square pixels must retain the original display aspect');
		assert.deepEqual(geometry.pixelAspectRatio, { num: 1, den: 1 });

		const original = new Blob([videoRetimePreviewMedia.file.buffer]);
		const vfr = await generate(core, original);
		const before = await demuxVideoTiming(original), after = await demuxVideoTiming(vfr);
		assert.deepEqual(after.presentationTicks.map(tick => Number(tick) / after.timescale), before.presentationTicks.map(tick => Number(tick) / before.timescale));
		assert.equal(Number(after.finalFrameDurationTicks) / after.timescale, Number(before.finalFrameDurationTicks) / before.timescale);

		core.FS.writeFile('tiny.rgba', Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255));
		core.reset();
		assert.equal(core.exec('-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '2x1', '-framerate', '1', '-i', 'tiny.rgba', '-frames:v', '2', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', 'tiny.webm'), 0);
		const tiny = await generate(core, new Blob([Uint8Array.from(core.FS.readFile('tiny.webm'))]));
		const tinyGeometry = await readContainerVideoSourceCharacteristics(tiny);
		assert.equal(tinyGeometry.codedHeight, 2);
		assert.equal(tinyGeometry.codedWidth, 4);
	} finally {
		if (previousLocation === undefined) Reflect.deleteProperty(globalThis, 'location');
		else Reflect.set(globalThis, 'location', previousLocation);
		if (previousSelf === undefined) Reflect.deleteProperty(globalThis, 'self');
		else Reflect.set(globalThis, 'self', previousSelf);
	}
});

test('the opaque H264 proxy recipe refuses alpha before borrowing the encoder', async () => {
	let invoked = false;
	const generator = createFfmpegVideoProxyGenerator({ runOperation() { invoked = true; throw new Error('encoder must not run'); } });
	const alpha = new Blob([await readFile(new URL('./browser/fixtures/corridorkey/keyed-alpha.webm', import.meta.url))]);
	await assert.rejects(Promise.resolve(generator.generate(alpha, identity, VIDEO_PROXY_GENERATION_RECIPE, current)), /alpha.*proxy|proxy.*alpha/iu);
	assert.equal(invoked, false);
});
