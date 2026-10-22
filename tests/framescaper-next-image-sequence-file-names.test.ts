/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FramescaperNativeImageSequenceSelectionBroker } from '../desktop/native-image-sequence-selection.ts';
import { resolveNativeMediaImageSequence } from '../src/common/editor/native-media-image-sequence.ts';
import { createNativeMediaImageSequenceInventoryV25 } from '../src/common/editor/native-media-image-sequence-v25.ts';
import { createPngFixture } from './helpers/png-fixture.mjs';

for (const separator of ['\n', '\u2028']) test(`native image-sequence chooser retains a legal filename stem containing ${JSON.stringify(separator)}`, async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-sequence-name-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const bytes = createPngFixture(1);
	const names = [`Scene${separator}Take0001.png`, `Scene${separator}Take0002.png`];
	const paths = names.map(name => join(directory, name));
	await Promise.all(paths.map(path => writeFile(path, bytes)));
	let minted = 0;
	const broker = new FramescaperNativeImageSequenceSelectionBroker({
		selectFiles: async () => paths, mintOpaqueId: () => `${++minted}`.padStart(40, '0'),
	});
	context.after(() => { broker.dispose(); });
	const owner = {};
	const selected = await broker.select(owner);
	assert.ok(selected);
	assert.deepEqual(selected.files.map(({ name }) => name), names);
	assert.deepEqual([...await broker.read(owner, { selectionId: selected.selectionId,
		fileId: selected.files[0]!.fileId, offset: 0, length: bytes.byteLength })], [...bytes]);
	const resolved = resolveNativeMediaImageSequence({ fileNames: names, frameRate: { num: 24, den: 1 } });
	const inventory = createNativeMediaImageSequenceInventoryV25(resolved, names.map((fileName, index) => ({
		fileName, frameNumber: index + 1, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
	})));
	assert.equal(resolved.stem, `Scene${separator}Take`);
	assert.ok(inventory.bytes.byteLength > 0);
});
