/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

import { encodeWav } from '../../src/common/editor/wav.js';

export async function writeSherpaVadWave(context: TestContext, samples: Float32Array, sampleRate = 16_000) {
	const directory = await mkdtemp(join(tmpdir(), 'sherpa-vad-wave.'));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const audioPath = join(directory, 'selected.wav');
	const bytes = encodeWav([samples], { sampleRate, bitDepth: 32, float: true });
	assert.ok(bytes instanceof Uint8Array);
	await writeFile(audioPath, bytes);
	return { audioPath, audioByteLength: bytes.byteLength };
}
