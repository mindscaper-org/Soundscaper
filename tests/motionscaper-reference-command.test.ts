/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { decodeMotionNativeReference } from '../desktop/motionscaper-native-reference.ts';

test('reference execution retains owned command closure before reading its bounded decoder outputs', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-reference-command-'));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	// This protocol fixture tests the command wrapper, not libav decoding or the independent picture/audio oracle.
	const movie = join(directory, 'decoder-protocol.cjs');
	const metadata = { width: 1, height: 1, profile: 4, colorDepth: 10, alphaDepth: 10,
		colorPrimaries: 1, colorTransfer: 1, colorSpace: 1, frames: [{ num: 0, den: 1 }], audio: null };
	await writeFile(movie, `const fs = require('node:fs'); fs.writeFileSync(process.argv[2], Buffer.alloc(16)); fs.writeFileSync(process.argv[3], Buffer.alloc(0)); console.log(${JSON.stringify(JSON.stringify(metadata))});\n`);
	const decoded = await decodeMotionNativeReference(process.execPath, movie, directory);
	assert.deepEqual(decoded.metadata, metadata); assert.equal(decoded.rgba.length, 4); assert.equal(decoded.pcm.length, 0);
	await decodeMotionNativeReference(process.execPath, movie, directory);
	const receipts = (await readdir(directory)).filter(name => /^reference-decoder-[a-f\d-]+-command\.json$/u.test(name));
	assert.equal(receipts.length, 2, 'each reference decoder execution must leave a unique physical-closure receipt');
	for (const path of receipts) {
		const receipt = JSON.parse(await readFile(join(directory, path), 'utf8')) as Record<string, unknown>;
		assert.equal(receipt.closureObserved, true); assert.equal(receipt.failure, null);
		if (process.platform === 'linux') {
			assert.equal(receipt.code, 0); assert.equal(receipt.signal, null); assert.equal(typeof receipt.closedAt, 'string');
			assert.deepEqual(receipt.failures, []); assert.deepEqual(receipt.cleanupErrors, []); assert.deepEqual(receipt.survivingProcesses, []);
		} else assert.equal(receipt.outputWritersClosed, true);
		assert.deepEqual(receipt.argv, [process.execPath, movie, join(directory, 'reference.rgba'), join(directory, 'reference.pcm')]);
	}
});
