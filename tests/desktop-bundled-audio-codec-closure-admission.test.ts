/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
	BUNDLED_AUDIO_CODEC_IDS,
	normalizeBundledAudioCodecHelperConfiguration,
} from '../desktop/bundled-audio-codec-helper-configuration.ts';
import {
	BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_NAME,
	DESKTOP_BUNDLED_AUDIO_CODEC_ISOLATION_FILES,
	createBundledAudioCodecRuntimeManifest,
	createBundledAudioCodecRuntimeVerifier,
	serializeBundledAudioCodecRuntimeManifest,
} from '../desktop/bundled-audio-codec-runtime-payload.mjs';
import { createBundledAudioCodecElectronSpawn } from '../desktop/bundled-audio-codec-electron-spawn.mjs';

// Exercise the build manifest, runtime verifier, helper admission and Electron
// transport together; independent unit fixtures previously hid inventory drift.
test('every authenticated packaged codec closure is admitted unchanged by its helper and transport', async context => {
	const root = await mkdtemp(join(tmpdir(), 'codec-closure-admission-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const file of DESKTOP_BUNDLED_AUDIO_CODEC_ISOLATION_FILES) {
		const output = join(root, file.path);
		await mkdir(dirname(output), { recursive: true });
		if (file.role === 'wasm') await copyFile(resolve(file.path.replace(/^project-library-runtime\//u, '')), output);
		else await writeFile(output, 'export {};\n');
	}
	await writeFile(join(root, BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_NAME), serializeBundledAudioCodecRuntimeManifest(
		await createBundledAudioCodecRuntimeManifest({ desktopRoot: root }),
	));
	let forks = 0;
	const spawn = createBundledAudioCodecElectronSpawn({ helperPath: join(root, 'helper.js'), fork() {
		forks++;
		return { on() {}, off() {}, postMessage() {}, kill() {} };
	} });
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		const verify = createBundledAudioCodecRuntimeVerifier({ desktopRoot: root, target });
		for (const codec of BUNDLED_AUDIO_CODEC_IDS) {
			const configuration = await verify(codec);
			assert.deepEqual(normalizeBundledAudioCodecHelperConfiguration(configuration), configuration);
			spawn(configuration);
			assert.throws(() => normalizeBundledAudioCodecHelperConfiguration({
				...configuration, dependencies: configuration.dependencies.slice(1),
			}), /dependency inventory/u);
			assert.throws(() => spawn({
				...configuration, dependencies: configuration.dependencies.slice(1),
			}), /configuration is invalid/u);
		}
	}
	assert.equal(forks, 35);
});
