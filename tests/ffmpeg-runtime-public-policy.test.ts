/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import viteConfig from '../vite.config.mjs';
import policy from '../config/ffmpeg-runtime-publication-policy.json';
import {
	builtFfmpegRuntimeReleaseBaseUrl,
	ffmpegRuntimeReleaseBaseUrl,
	FFMPEG_RUNTIME_POINTER_URL,
} from '../src/common/offline/ffmpeg-runtime-public-policy.ts';

test('runtime publication remains reproducible but browser builds do not pin or load it', async () => {
	const manifestBytes = await readFile('config/ffmpeg-runtime-manifest.json');
	const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
	assert.equal(Object.hasOwn(viteConfig.define ?? {}, '__FFMPEG_RUNTIME_MANIFEST_SHA256__'), false);
	assert.equal(
		FFMPEG_RUNTIME_POINTER_URL,
		'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/latest.json',
	);
	assert.deepEqual(policy.pages, {
		origin: 'https://soundscaper.org',
	});
	assert.deepEqual(policy.runtimeFiles, [
		{ name: 'ffmpeg-core.js', contentType: 'text/javascript; charset=utf-8' },
		{ name: 'ffmpeg-core.wasm', contentType: 'application/wasm' },
	]);
	assert.deepEqual(policy.releaseMetadata, {
		manifest: { contentType: 'application/json; charset=utf-8' },
		notice: { contentType: 'text/markdown; charset=utf-8' },
		correspondingSource: { contentType: 'application/json; charset=utf-8' },
	});
	assert.equal(policy.cloudflare.pagesRuleRef, 'soundscaper-pages-browser-origin-v1');
	assert.equal(
		ffmpegRuntimeReleaseBaseUrl(manifestSha256),
		`https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${manifestSha256}`,
	);
	assert.equal(builtFfmpegRuntimeReleaseBaseUrl(), null, 'the raw Node test has no build-time release injection');
});

test('content-addressed release URL construction rejects partial or mutable identifiers', () => {
	for (const value of ['latest', 'a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(64)}/nested`]) {
		assert.throws(() => ffmpegRuntimeReleaseBaseUrl(value), /release ID is invalid/u);
	}
});

test('browser configuration keeps the runtime origin governed by the publication policy', async () => {
	const workflowNames = (await readdir('.github/workflows'))
		.filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
	const [editorSource, viteEnvironment, exampleEnvironment, technicalReadme, ...workflowSources] =
		await Promise.all([
			readFile('src/common/editor/ffmpeg.js', 'utf8'),
			readFile('src/vite-env.d.ts', 'utf8'),
			readFile('.env.example', 'utf8'),
			readFile('Technical_README.md', 'utf8'),
			...workflowNames.map((name) => readFile(`.github/workflows/${name}`, 'utf8')),
		]);
	assert.doesNotMatch(editorSource, /assets\.soundscaper\.org\/runtime\/ffmpeg\/0\.12\.10/u);
	assert.doesNotMatch(editorSource, /PUBLIC_FFMPEG_CORE_BASE_URL/u);
	for (const source of [viteEnvironment, exampleEnvironment, technicalReadme, ...workflowSources]) {
		assert.doesNotMatch(source, /PUBLIC_FFMPEG_CORE_BASE_URL/u);
	}
});
