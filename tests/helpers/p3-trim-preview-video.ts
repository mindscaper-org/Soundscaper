/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
export interface P3VideoCore {
	exec(...args: string[]): number;
	setLogger(callback: (event: { message: string }) => void): void;
	readonly FS: { writeFile(path: string, bytes: Uint8Array | string): void; readFile(path: string): Uint8Array; unlink(path: string): void };
}
/** Pinned encoder authors four one-second solid colours, each frame independently decodable. */
export async function p3TrimPreviewVideo(): Promise<{ bytes: Uint8Array<ArrayBuffer>; core: P3VideoCore }> {
	const location = new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url);
	if (!('self' in globalThis)) Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
	if (!('location' in globalThis)) Object.defineProperty(globalThis, 'location', { configurable: true, value: location });
	const [{ default: createCore }, wasmBinary] = await Promise.all([
		import(location.href) as Promise<{ default: (options: { wasmBinary: Uint8Array }) => Promise<P3VideoCore> }>,
		readFile(new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url)),
	]);
	const core = await createCore({ wasmBinary });
	const pixels = new Uint8Array(64 * 32 * 3 * 100);
	const colours = [[240, 16, 16], [16, 240, 16], [16, 16, 240], [240, 240, 16]] as const;
	for (let frame = 0; frame < 100; frame += 1) {
		const colour = colours[Math.floor(frame / 25)]!;
		for (let pixel = 0; pixel < 64 * 32; pixel += 1) pixels.set(colour, (frame * 64 * 32 + pixel) * 3);
	}
	core.FS.writeFile('four-colours.rgb', pixels);
	assert.equal(core.exec('-hide_banner', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '64x32',
		'-framerate', '25', '-i', 'four-colours.rgb', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '1',
		'-pix_fmt', 'yuv420p', '-an', '-y', 'four-colours.mp4'), 0);
	return { bytes: Uint8Array.from(core.FS.readFile('four-colours.mp4')), core };
}
