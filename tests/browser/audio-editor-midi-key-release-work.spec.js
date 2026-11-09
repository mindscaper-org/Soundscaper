/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

function midiKeyQueueFile(count, burst) {
	const body = [0, 255, 81, 3, 7, 161, 32];
	if (burst) {
		for (let index = 0; index < count; index += 1) body.push(0, 144, 60, 90);
		for (let index = 0; index < count; index += 1) body.push(index === 0 ? 1 : 0, 128, 60, 64);
	} else for (let index = 0; index < count; index += 1) body.push(0, 144, 60, 90, 1, 128, 60, 64);
	body.push(0, 255, 47, 0);
	const header = [77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 127, 255, 77, 84, 114, 107];
	const bytes = new Uint8Array(header.length + 4 + body.length);
	bytes.set(header);
	new DataView(bytes.buffer).setUint32(header.length, body.length);
	bytes.set(body, header.length + 4);
	return Buffer.from(bytes);
}

for (const burst of [false, true]) test(`actual MIDI file key release queue work burst=${burst}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await page.evaluate(() => {
		globalThis.__keyQueueMoves = 0;
		const splice = Array.prototype.splice;
		Array.prototype.splice = function (...args) {
			const start = args[0];
			if (args[1] === 1 && this.length > 128 && this[0]?.event?.status === 144
				&& typeof this[0]?.track === 'number') globalThis.__keyQueueMoves += this.length - start - 1;
			return Reflect.apply(splice, this, args);
		};
	});
	await importFiles(editor, [{ name: burst ? 'Unison stack.mid' : 'Repeated keys.mid', mimeType: 'audio/midi',
		buffer: midiKeyQueueFile(10_000, burst) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const moves = await page.evaluate(() => globalThis.__keyQueueMoves);
	expect(moves).toBeLessThanOrEqual(160_000);
});
