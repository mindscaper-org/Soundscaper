/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';

interface Core {
	FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array };
	exec(...args: string[]): number;
	reset(): void;
}

test('outline and shadow retain each original picture at 60fps', async () => {
	const previousSelf: unknown = Reflect.get(globalThis, 'self');
	Reflect.set(globalThis, 'self', { location: { href: import.meta.url } });
	try {
		const moduleName = '@ffmpeg/core';
		const { default: createCore } = await import(moduleName) as { default(options: { wasmBinary: Uint8Array }): Promise<Core> };
		const core = await createCore({ wasmBinary: await readFile(new URL('../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url)) });
		const width = 32, height = 32, frameCount = 12;
		const source = new Uint8Array(width * height * 4 * frameCount);
		for (let frame = 0; frame < frameCount; frame++) for (let pixel = 0; pixel < width * height; pixel++) {
			const offset = (frame * width * height + pixel) * 4;
			source[offset] = (frame + 1) * 20;
			source[offset + 3] = 255;
		}
		core.FS.writeFile('in.rgba', source);
		for (const type of ['outline', 'drop-shadow'] as const) {
			const effect = createVideoEffect(type, { params: type === 'outline' ? { width: 1, opacity: 1 } : { sigma: 0, offsetX: 0, offsetY: 0, opacity: 1 } });
			const operation = serializeVideoEffectsToFfmpegOperations([effect])[0];
			assert.ok(operation);
			const filters: string[] = [];
			appendVideoEffectOperation({ filters, inputLabel: '0:v', outputLabel: 'out', operation, width, height });
			core.reset();
			assert.equal(core.exec('-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`, '-framerate', '60', '-i', 'in.rgba', '-filter_complex', filters.join(';'), '-map', '[out]', '-t', '0.2', '-r', '60', '-pix_fmt', 'rgba', '-f', 'rawvideo', `${type}.rgba`), 0);
			assert.deepEqual(core.FS.readFile(`${type}.rgba`), source, `${type} must preserve every opaque original frame`);
		}
	} finally {
		if (previousSelf === undefined) Reflect.deleteProperty(globalThis, 'self');
		else Reflect.set(globalThis, 'self', previousSelf);
	}
});
