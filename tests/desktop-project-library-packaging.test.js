/* SPDX-License-Identifier: AGPL-3.0-only */


import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	DESKTOP_EXPECTED_RUNTIME_FILES,
	DESKTOP_RUNTIME_PACKAGE_IMPORTS,
} from '../scripts/lib/desktop-project-library-runtime.mjs';
import { compileDesktopRuntimeTestFixture } from '../scripts/lib/node-test-desktop-runtime-fixture.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop runtime compilation emits importable JavaScript with rewritten extensions', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-desktop-runtime-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const result = await compileDesktopRuntimeTestFixture({ repositoryRoot: ROOT, outputRoot });
	// The compile fails closed on its own manifest, so a second hand-maintained
	// copy of the same 450-line list here carried no independent signal — both
	// copies are written by the same change — and a slice that added five
	// runtime members left this one behind and broke the quality gate. Pin the
	// reported set to the shipped manifest and keep the checks below, which say
	// something the manifest cannot: that the output actually imports.
	assert.deepEqual(result.files, [...DESKTOP_EXPECTED_RUNTIME_FILES]);
	for (const name of result.files) {
		const source = await readFile(join(outputRoot, name), 'utf8');
		assert.doesNotMatch(source, /from ['"].*\.ts['"]/u);
	}
	const packagedRuntimePrefix = './desktop/project-library-runtime/';
	for (const [specifier, target] of Object.entries(DESKTOP_RUNTIME_PACKAGE_IMPORTS)) {
		assert.ok(target.startsWith(packagedRuntimePrefix),
			`${specifier} must resolve inside the packaged desktop runtime`);
		assert.ok(result.files.includes(target.slice(packagedRuntimePrefix.length)),
			`${specifier} must resolve to a compiled desktop runtime member`);
	}
	assert.ok(result.files.includes('src/common/editor/project-hierarchy-document-validation.js'));
	assert.ok(result.files.includes('src/common/editor/project-effect-tail-v21.js'));
	const takeGroupSources = await import(pathToFileURL(join(
		outputRoot, 'src/common/editor/take-group-source-references.js',
	)).href);
	assert.deepEqual([...takeGroupSources.collectTakeGroupSourceIds({
		takeGroups: [{ takes: [{ sourceId: 'take-owned-recording' }] }],
	})], ['take-owned-recording']);
	assert.ok(result.files.includes('src/common/editor/source-provenance-extensions.js'));
	assert.ok(result.files.includes('src/common/editor/source-provenance.js'));
	assert.equal(result.files.includes('src/common/editor/engine/types.js'), false,
		'type-only engine shapes must not become packaged runtime members');
	assert.ok(result.files.includes('src/common/editor/track-folder-v12.js'));
	assert.ok(result.files.includes('src/common/editor/track-display-mode.js'));
	assert.ok(result.files.includes('src/common/editor/track-hierarchy-v12.js'));
	assert.ok(result.files.includes('src/common/editor/timeline-annotation.js'));
	assert.ok(result.files.includes('desktop/assistance-float32-mono-wave-file-reader.js'));
	assert.ok(result.files.includes('desktop/assistance-onnx-worker-common.js'));
	assert.ok(result.files.includes('src/common/editor/mixer-signal-edge-v21.js'));
	assert.ok(result.files.includes(
		'src/common/editor/assistance/workflow-claim-correlation-v1.js',
	));
	assert.equal(result.files.includes('src/common/editor/project-current.js'), false);
	// This Main consumer authenticates persisted body bytes; it does not estimate
	// motion or acquire frames. The isolated emitted tree has no node_modules.
	assert.equal(result.files.includes('src/common/editor/video-motion-analysis-v27.js'), false);
	assert.ok(result.files.includes('src/common/editor/video-motion-analysis-body-v1.js'));
	const motion = await import(pathToFileURL(join(outputRoot, 'src/common/editor/video-motion-analysis-body-v1.js')).href);
	assert.equal(motion.analyzeVideoMotionV1, undefined);
	const stack = { schemaVersion: 1, id: 'stack', sourceId: 'source', processors: [] };
	const hash = bytes => createHash('sha256').update(bytes).digest('hex');
	const sourceSha = 'a'.repeat(64), settingsSha = hash(new TextEncoder().encode(JSON.stringify(stack)));
	assert.equal(motion.videoMotionSettingsSha256V1(stack), settingsSha);
	const body = { schemaVersion: 1, analysisId: 'analysis', sourceId: 'source', processorStackId: 'stack',
		inputSha256: sourceSha, settingsSha256: settingsSha, analysisWidth: 4, analysisHeight: 3, startFrame: 0, endFrame: 1, transforms: [] };
	const bytes = new TextEncoder().encode(JSON.stringify(body)), digest = hash(bytes);
	const reference = { schemaVersion: 1, id: 'analysis', sourceId: 'source', processorStackId: 'stack', inputSha256: sourceSha,
		settingsSha256: settingsSha, storageKey: `motion-sha256:${digest}`, sha256: digest, byteLength: bytes.byteLength, startFrame: 0, endFrame: 1 };
	const expected = { inputSha256: sourceSha, processorStack: stack };
	assert.deepEqual(motion.requireVideoMotionAnalysisBodyV1(reference, bytes, expected), body);
	const corrupt = bytes.slice(); corrupt[corrupt.length - 1] = 0;
	assert.throws(() => motion.requireVideoMotionAnalysisBodyV1(reference, corrupt, expected), /digest|byte length/u);
	assert.throws(() => motion.requireVideoMotionAnalysisBodyV1(reference, bytes, { ...expected, inputSha256: 'b'.repeat(64) }));
	assert.equal(result.files.includes('src/common/editor/pffft.js'), true);
	assert.equal(result.files.includes('src/common/editor/native-plugin-realtime-contract.js'), true);
	assert.equal(result.files.includes('src/common/editor/native-plugin-realtime-worklet.js'), true);
	const riffText = await import(pathToFileURL(join(
		outputRoot, 'src/common/editor/riff-metadata-text.js',
	)).href);
	assert.equal(riffText.decodeRiffMetadataText(new Uint8Array([0x80, 0]), 1252), '€');
	const packagedNativePluginPlayback = await readFile(join(
		outputRoot, 'src/soundscaper/editor-native-plugin-playback.js',
	), 'utf8');
	assert.doesNotMatch(packagedNativePluginPlayback, /\?worker&url/u,
		'the Node runtime bundle must eliminate its Vite-only worker URL branch');
	const packagedNativePluginNode = await readFile(join(
		outputRoot, 'src/common/editor/native-plugin-realtime-node.js',
	), 'utf8');
	assert.match(packagedNativePluginNode, /native-plugin-realtime-worklet\.js\?worker&url/u,
		'the separately emitted module must preserve its Vite worker URL branch');
	assert.match(packagedNativePluginNode,
		/new URL\(["']\.\/native-plugin-realtime-worklet\.js["'],\s*import\.meta\.url\)/u,
		'the separately emitted module must retain the packaged worklet URL');
	const soundMain = await import(`${pathToFileURL(join(outputRoot, 'desktop/soundscaper-project-library-main.js')).href}?test=${Date.now()}`);
	const soundIpc = await import(`${pathToFileURL(join(outputRoot, 'desktop/soundscaper-project-library-main-ipc.js')).href}?test=${Date.now()}`);
	const frameMain = await import(`${pathToFileURL(join(outputRoot, 'desktop/framescaper-project-library-main.js')).href}?test=${Date.now()}`);
	const frameIpc = await import(`${pathToFileURL(join(outputRoot, 'desktop/framescaper-project-library-main-ipc.js')).href}?test=${Date.now()}`);
	const exactMain = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-exact-generation-main.js')).href}?test=${Date.now()}`);
	const exactIpc = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-exact-generation-main-ipc.js')).href}?test=${Date.now()}`);
	assert.equal(typeof soundMain.SoundscaperDesktopProjectLibraryMain?.start, 'function');
	assert.equal(typeof soundIpc.registerSoundscaperDesktopProjectLibraryMainIpc, 'function');
	assert.equal(typeof frameMain.FramescaperDesktopProjectLibraryMain?.start, 'function');
	assert.equal(typeof frameIpc.registerFramescaperDesktopProjectLibraryMainIpc, 'function');
	assert.equal(typeof exactMain.FramescaperDesktopProjectLibraryExactGenerationMain?.start, 'function');
	assert.equal(typeof exactIpc.registerFramescaperDesktopProjectLibraryExactGenerationMainIpc, 'function');
	assert.equal(result.files.some((file) => /(?:^|\/)project-library-v\d+(?:-|\.)/u.test(file)), false);
	for (const retired of [
		'desktop/project-library-host.js',
		'desktop/project-library-editor-service.js',
		'desktop/project-library-editor-media-service.js',
		'desktop/project-library-media.js',
	]) assert.equal(result.files.includes(retired), false, `${retired} must not ship`);
});
