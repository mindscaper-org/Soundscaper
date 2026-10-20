/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { statSync, watch } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { materializeNativeRenderInputFiles } from '../desktop/native-services-render-input-materialization.ts';

test('durable render-input materialization aborts between chunks and removes its partial copy', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-materialize-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceDirectory = join(root, 'source');
	const targetDirectory = join(root, 'target');
	await mkdir(sourceDirectory);
	await mkdir(targetDirectory);
	const bytes = Buffer.alloc(8 * 1024 * 1024, 0x5a);
	const sourcePath = join(sourceDirectory, 'input-00.frames');
	await writeFile(sourcePath, bytes);
	const details = await lstat(sourcePath);
	const abort = new AbortController();
	let copiedBytes = 0;
	const watcher = watch(targetDirectory, (event, name) => {
		if (event !== 'change' || String(name) !== 'derived-00.frames' || abort.signal.aborted) return;
		copiedBytes = statSync(join(targetDirectory, 'derived-00.frames')).size;
		abort.abort(new DOMException('cancelled', 'AbortError'));
	});

	await assert.rejects(materializeNativeRenderInputFiles({
		sourceDirectory, targetDirectory, signal: abort.signal,
		files: [Object.freeze({
			name: 'input-00.frames', role: 'evaluated-rgba-frame-pack' as const,
			byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
			identity: Object.freeze({ dev: details.dev, ino: details.ino }),
		})],
	}), /cancelled/u).finally(() => watcher.close());
	assert.ok(copiedBytes > 0 && copiedBytes < bytes.byteLength, 'cancellation follows a real partial write');
	assert.deepEqual(await readdir(targetDirectory), [], 'an aborted helper scratch copy is removed');
});
