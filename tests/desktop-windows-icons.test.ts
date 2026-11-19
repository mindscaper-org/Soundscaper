/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { convertIcon } from 'app-builder-lib/out/util/iconConverter.js';

import { generateDesktopIcon } from '../scripts/desktop-icons.mjs';

test('Windows packaging uses a prepared ICO containing each product raster without invoking the converter', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-windows-icons-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const sizes = [16, 24, 32, 48, 64, 96, 128, 256];
	for (const product of ['soundscaper', 'framescaper', 'lightscaper']) {
		await generateDesktopIcon({
			sourcePath: resolve(import.meta.dirname, `../public/logo/${product}.svg`),
			outputPath: join(root, 'icon.png'),
		});
		const iconPath = join(root, 'icon.ico');
		const bytes = await readFile(iconPath);
		assert.equal(bytes.readUInt16LE(0), 0);
		assert.equal(bytes.readUInt16LE(2), 1);
		assert.equal(bytes.readUInt16LE(4), sizes.length);
		let offset = 6 + 16 * sizes.length;
		for (const [index, size] of sizes.entries()) {
			const entry = 6 + index * 16;
			assert.equal(bytes[entry] || 256, size);
			assert.equal(bytes[entry + 1] || 256, size);
			assert.equal(bytes.readUInt16LE(entry + 4), 1);
			assert.equal(bytes.readUInt16LE(entry + 6), 32);
			assert.equal(bytes.readUInt32LE(entry + 12), offset);
			const length = bytes.readUInt32LE(entry + 8);
			assert.deepEqual(bytes.subarray(offset, offset + length),
				await readFile(join(root, 'linux', `${size}x${size}.png`)));
			offset += length;
		}
		assert.equal(offset, bytes.length);
		const converted = await convertIcon({
			sources: [iconPath], fallbackSources: [], roots: [root],
			format: 'ico', outDir: join(root, 'unused-converter-output'),
		});
		assert.deepEqual(converted, { icons: [{ file: iconPath, size: 256 }], isFallback: false });
	}
});
