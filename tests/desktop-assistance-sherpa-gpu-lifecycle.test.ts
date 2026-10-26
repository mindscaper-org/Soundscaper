/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { patchSherpaGpuSources } from '../scripts/lib/desktop-assistance-sherpa-gpu-sources.mjs';

const run = promisify(execFile);

test('Sherpa disposes native handles exactly once before unregistering, including partial failures and reuse', {
	skip: process.platform === 'win32' ? 'The portable C++ fixture uses a POSIX compiler driver.' : false,
}, async context => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-sherpa-context-lifecycle-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	for (const name of ['onnxruntime_cxx_api.h', 'webgpu_probe.h', 'sherpa-handles.cc']) {
		await copyFile(new URL(`./fixtures/assistance-gpu-lifecycle/${name}`, import.meta.url), join(directory, name));
	}
	for (const name of ['owned-handles.h', 'webgpu-provider.cc']) {
		await copyFile(new URL(`../native/assistance-sherpa-gpu/${name}`, import.meta.url), join(directory, name));
	}
	const executable = join(directory, 'lifecycle');
	await run('c++', ['-std=c++17', '-pthread', join(directory, 'sherpa-handles.cc'),
		...(process.platform === 'linux' ? ['-ldl'] : []), '-o', executable]);
	const completed = await run(executable, [], { timeout: 10_000 });
	assert.equal(completed.stderr, '');
});

test('the pinned Sherpa source patch binds every speech owner and installs explicit disposal', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-sherpa-disposal-patch-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	await mkdir(join(directory, 'cpp'));
	const owners = {
		'vad.cc': ['SherpaOnnxVoiceActivityDetector'],
		'non-streaming-asr.cc': ['SherpaOnnxOfflineRecognizer', 'SherpaOnnxOfflineStream'],
		'non-streaming-speaker-diarization.cc': ['SherpaOnnxOfflineSpeakerDiarization'],
	};
	const patchSourceFiles: Record<string, string> = {};
	for (const [name, types] of Object.entries(owners)) {
		const source = types.map(type => `Napi::External<${type}>`).join('\n');
		await writeFile(join(directory, 'cpp', name), source);
		patchSourceFiles[`cpp/${name}`] = createHash('sha256').update(source).digest('hex');
	}
	const entry = 'Napi::Object Init(Napi::Env env, Napi::Object exports) {\n  return exports;\n}';
	await writeFile(join(directory, 'cpp/sherpa-onnx-node-addon-api.cc'), entry);
	patchSourceFiles['cpp/sherpa-onnx-node-addon-api.cc'] = createHash('sha256').update(entry).digest('hex');
	const exports = '_SherpaOnnxExisting\n';
	await writeFile(join(directory, 'cpp/sherpa-onnx-symbols-c.exp'), exports);
	patchSourceFiles['cpp/sherpa-onnx-symbols-c.exp'] = createHash('sha256').update(exports).digest('hex');
	await patchSherpaGpuSources(directory, { patchSourceFiles });
	for (const [name, types] of Object.entries(owners)) {
		const source = await readFile(join(directory, 'cpp', name), 'utf8');
		assert.ok(source.startsWith('#include "owned-external.h"'));
		for (const type of types) assert.ok(source.includes(`ScapeOwnedExternal<${type}>`));
	}
	assert.match(await readFile(join(directory, 'cpp/sherpa-onnx-node-addon-api.cc'), 'utf8'),
		/InitScapeSpeechDisposal\(env, exports\);/u);
	assert.equal(await readFile(join(directory, 'cpp/sherpa-onnx-symbols-c.exp'), 'utf8'),
		'_SherpaOnnxExisting\n_SherpaOnnxReleaseWebGpuProvider\n');
	await assert.rejects(patchSherpaGpuSources(directory, { patchSourceFiles }), /has changed/u);
});
