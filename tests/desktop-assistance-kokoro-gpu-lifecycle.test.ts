/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('Kokoro GPU contexts unregister their provider after the last session, including failed admission', {
	skip: process.platform === 'win32' ? 'The portable C++ fixture uses a POSIX compiler driver.' : false,
}, async context => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-g2p-context-lifecycle-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	for (const name of ['onnxruntime_cxx_api.h', 'webgpu_probe.h', 'kokoro-context.cc']) {
		await copyFile(new URL(`./fixtures/assistance-gpu-lifecycle/${name}`, import.meta.url), join(directory, name));
	}
	await copyFile(new URL('../native/assistance-kokoro-g2p-gpu/ort-gemm.cc', import.meta.url), join(directory, 'ort-gemm.cc'));
	const executable = join(directory, 'lifecycle');
	await run('c++', ['-std=c++20', '-pthread', join(directory, 'kokoro-context.cc'),
		...(process.platform === 'linux' ? ['-ldl'] : []), '-o', executable]);
	const completed = await run(executable, [], { timeout: 10_000 });
	assert.equal(completed.stderr, '');
});
