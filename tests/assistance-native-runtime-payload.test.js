/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import manifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import {
	assistanceNativeRuntimeStageSummary,
	assistanceNativeRuntimeTargetId,
	stageAssistanceNativeRuntimePayload,
	verifyAssistanceNativeRuntimePayload,
} from '../desktop/assistance-native-runtime-payload.mjs';

for (const targetId of Object.keys(manifest.targets)) test(`package-generated ${targetId} carries no source-checkout executable bytes`, async (context) => {
	const outputRoot = await temporaryRoot(context);
	const summary = await stageAssistanceNativeRuntimePayload({
		manifest, targetId, nodeModulesRoot: resolve('node_modules'), outputRoot,
	});
	assert.equal(summary.status, 'package-generated');
	assert.equal(summary.blockedBy, null);
	const verified = await verifyAssistanceNativeRuntimePayload({ manifest, targetId, outputRoot });
	assert.equal(verified.status, 'package-generated');
	assert.equal(verified.moduleSpecifier, null);
	await cp(resolve('node_modules/sherpa-onnx-node'),
		join(outputRoot, manifest.runtimePrefix, 'node_modules/sherpa-onnx-node'), { recursive: true });
	await assert.rejects(
		verifyAssistanceNativeRuntimePayload({ manifest, targetId, outputRoot }),
		/package-generated.*payload|must not carry/iu,
	);
});

test('platform identities map only to the five release targets', () => {
	assert.equal(assistanceNativeRuntimeTargetId({ platform: 'linux', arch: 'x64' }), 'linux-x64');
	assert.equal(assistanceNativeRuntimeTargetId({ platform: 'linux', arch: 'arm64' }), 'linux-arm64');
	assert.equal(assistanceNativeRuntimeTargetId({ platform: 'darwin', arch: 'arm64' }), 'mac-arm64');
	assert.equal(assistanceNativeRuntimeTargetId({ platform: 'win32', arch: 'x64' }), 'win-x64');
	assert.equal(assistanceNativeRuntimeTargetId({ platform: 'win32', arch: 'arm64' }), 'win-arm64');
	assert.throws(() => assistanceNativeRuntimeTargetId({ platform: 'darwin', arch: 'x64' }), /unsupported/iu);
});

test('production assistance registration verifies the target payload before helper spawn', async () => {
	const source = await readFile(new URL('../desktop/assistance-registration.mjs', import.meta.url), 'utf8');
	assert.match(source, /verifyAssistanceNativeRuntimePayload/iu);
	assert.match(source, /SOUNDSCAPER_ASSISTANCE_RUNTIME_ROOT/iu);
	assert.doesNotMatch(source, /verifyBinary:\s*\(\)\s*=>\s*Promise\.resolve/iu);
});

test('legacy Sherpa payloads cannot claim unbuilt GPU providers', () => {
	for (const executionProviders of [
		['webgpu', 'cpu'], ['coreml', 'cpu'], ['cuda', 'cpu'], ['webgpu'], ['cpu', 'cpu'],
	]) {
		const changed = structuredClone(manifest);
		changed.targets['linux-x64'] = { status: 'built', blockedBy: null, executionProviders,
			package: { ...manifest.commonPackage, name: 'sherpa-onnx-linux-x64' } };
		assert.throws(() => assistanceNativeRuntimeStageSummary(changed, 'linux-x64'),
			/GPU|provider|capabilit/iu);
	}
});

async function temporaryRoot(context) {
	const root = await mkdtemp(join(tmpdir(), 'assistance-native-runtime-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}
