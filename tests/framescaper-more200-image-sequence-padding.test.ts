/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FramescaperNativeImageSequenceSelectionBroker } from '../desktop/native-image-sequence-selection.ts';
import { resolveNativeMediaImageSequence, nativeMediaImageSequencePattern } from '../src/common/editor/native-media-image-sequence.ts';
import { createNativeMediaImageSequenceInventoryV25 } from '../src/common/editor/native-media-image-sequence-v25.ts';
import { createPngFixture } from './helpers/png-fixture.mjs';

test('native File Import accepts the normal printf %02d decade overflow without renumbering', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-sequence-padding-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const bytes = createPngFixture(1);
	const numbers = Array.from({ length: 94 }, (_, index) => index + 8);
	const names = numbers.map(number => `shot.${String(number).padStart(2, '0')}.png`);
	const paths = names.map(name => join(directory, name));
	await Promise.all(paths.map(path => writeFile(path, bytes)));
	let minted = 0;
	const broker = new FramescaperNativeImageSequenceSelectionBroker({
		selectFiles: async () => paths.toReversed(), mintOpaqueId: () => `${++minted}`.padStart(40, '0'),
	});
	context.after(() => broker.dispose());
	const owner = {};
	const selected = await broker.select(owner); assert.ok(selected);
	assert.deepEqual(selected.files.map(({ name }) => name), names.toReversed());
	assert.deepEqual(await broker.read(owner, { selectionId: selected.selectionId,
		fileId: selected.files[0]!.fileId, offset: 0, length: bytes.byteLength }), Uint8Array.from(bytes));
	const sequence = resolveNativeMediaImageSequence({ fileNames: selected.files.map(({ name }) => name), frameRate: { num: 24, den: 1 } });
	assert.equal(nativeMediaImageSequencePattern(sequence), 'shot.%02d.png');
	assert.deepEqual(sequence.frames.map(({ fileName }) => fileName), names);
	const inventory = createNativeMediaImageSequenceInventoryV25(sequence, names.map((fileName, index) => ({
		fileName, frameNumber: numbers[index]!, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
	})));
	assert.equal(inventory.reference.frameCount, numbers.length);
	assert.equal(await broker.release(owner, { selectionId: selected.selectionId }), true);
});
