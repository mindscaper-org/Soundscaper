/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

async function readRuntimeSupplyChainRisk() {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	return matrix.risks.find(({ id }) => id === 'runtime-supply-chain');
}
test('legacy FFmpeg WASM publication remains blocked and absent from production browsers', async () => {
	const runtimeSupplyChain = await readRuntimeSupplyChainRisk();
	assert.ok(runtimeSupplyChain);
	const legacyRuntime = runtimeSupplyChain.currentControls.find(
		({ id }) => id === 'validated-ffmpeg-runtime-publication',
	);
	assert.ok(legacyRuntime);
	for (const path of [
		'THIRD_PARTY_LICENSES.md',
		'config/ffmpeg-runtime-manifest.json',
		'config/ffmpeg-runtime-publication-policy.json',
		'config/production-licensing-matrix.json',
		'scripts/lib/ffmpeg-runtime-manifest.mjs',
		'scripts/lib/ffmpeg-runtime-publisher.mjs',
		'scripts/publish-runtime-assets.mjs',
		'scripts/audit-ffmpeg-runtime.mjs',
		'scripts/lib/browser-bundle-codec-audit.mjs',
		'scripts/check-build-chunks.mjs',
		'scripts/lib/offline-service-worker.mjs',
		'tests/ffmpeg-runtime-manifest.test.js',
		'tests/ffmpeg-runtime-publisher.test.js',
		'tests/browser-bundle-codec-audit.test.js',
		'tests/offline-service-worker.test.js',
		'tests/browser/offline-ffmpeg-runtime-download.spec.js',
	]) assert.ok(legacyRuntime.evidence.some((item) => item.path === path), path);
	assert.equal(legacyRuntime.evidence.some(({ path }) => path === 'src/common/editor/ffmpeg.js'), false);

	const reactivation = runtimeSupplyChain.residualRisks.find(
		({ id }) => id === 'served-external-runtime-authentication',
	);
	assert.ok(reactivation);
	const attestation = runtimeSupplyChain.residualRisks.find(
		({ id }) => id === 'runtime-manifest-review-attestation',
	);
	assert.equal(attestation, undefined);
	const unsignedRelease = runtimeSupplyChain.residualRisks.find(
		({ id }) => id === 'unsigned-manual-release-integrity',
	);
	assert.ok(unsignedRelease);
});
