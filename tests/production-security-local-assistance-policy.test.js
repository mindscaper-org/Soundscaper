/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryUrl = new URL('../', import.meta.url);

async function readJson(path) {
	return JSON.parse(await readFile(new URL(path, repositoryUrl), 'utf8'));
}

test('local-assistance controls retain workflow, publication, and residual-risk evidence', async () => {
	const matrix = await readJson('config/production-security-matrix.json');
	const ipcRisk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const control = ipcRisk?.currentControls.find(
		({ id }) => id === 'local-assistance-pathless-operation-bridge',
	);
	const supplyControl = matrix.risks.flatMap(({ currentControls }) => currentControls)
		.find(({ id }) => id === 'digest-pinned-local-model-catalog-and-authenticated-store');
	const diagnosticsRisk = matrix.risks.flatMap(({ residualRisks }) => residualRisks)
		.find(({ id }) => id === 'local-assistance-runtime-diagnostics');
	const externalExecutableRisk = matrix.risks.flatMap(({ residualRisks }) => residualRisks)
		.find(({ id }) => id === 'external-ffmpeg-selected-executable-authority');
	assert.ok(matrix.groundedAt >= '2026-10-02');
	assert.ok(control);
	for (const path of [
		'desktop/assistance-workflow-service.ts',
		'desktop/assistance-runtime-family-manifest.ts',
		'desktop/assistance-workflow-operation-stage-runtime.ts',
		'desktop/assistance-sherpa-vad.ts',
		'desktop/assistance-sherpa-diarizer.ts',
		'desktop/assistance-external-ffmpeg-shot-runtime.ts',
		'desktop/external-ffmpeg-shot-detector.ts',
		'src/common/editor/assistance/workflow.ts',
		'src/common/editor/assistance/workflow-fence-v1.ts',
		'src/common/editor/assistance/workflow-recipes.ts',
		'src/common/editor/controller/assistance/internal/local-assistance-transcript-acceptance.ts',
		'src/common/editor/controller/assistance/internal/guided/local-assistance-guided-result-acceptance.ts',
		'src/common/editor/controller/assistance/internal/guided/local-assistance-guided-index-publication.ts',
		'src/common/editor/controller/assistance/internal/local-assistance-range-label-acceptance.ts',
		'src/common/editor/controller/assistance/internal/local-assistance-shot-acceptance.ts',
		'src/common/editor/controller/assistance/internal/local-assistance-cleanup-acceptance.ts',
		'src/common/editor/assistance/transcript-scape-asset-extension-v1.ts',
		'tests/audio-editor-local-assistance-transcript-acceptance.test.ts',
		'tests/audio-editor-local-assistance-range-label-acceptance.test.ts',
		'tests/audio-editor-local-assistance-shot-acceptance.test.ts',
		'tests/audio-editor-local-assistance-cleanup-acceptance.test.ts',
		'tests/audio-editor-assistance-transcript-scape-v1.test.ts',
	]) assert.ok(control.evidence.some(({ path: evidencePath }) => evidencePath === path), path);
	assert.ok(supplyControl);
	for (const path of [
		'config/milestone-7-model-catalog-tasks.json',
		'scripts/models/milestone-7-model-catalog-tasks.mjs',
		'tests/milestone-7-model-catalog-tasks.test.mjs',
	]) assert.ok(supplyControl.evidence.some(({ path: evidencePath }) =>
		evidencePath === path), path);
	assert.ok(diagnosticsRisk);
	assert.ok(externalExecutableRisk);
});

test('capability inventory records the shared Electron-only assistance surface for both products', async () => {
	const inventory = await readJson('config/production-capabilities.json');
	assert.equal(inventory.groundedAt, '2026-08-30');
	for (const productId of ['soundscaper', 'framescaper']) {
		const surface = inventory.products[productId].platforms['electron-only'];
		assert.equal(surface.status, 'partial');
		for (const path of [
			'desktop/local-model-catalog-integrity.ts',
			'desktop/local-model-store.ts',
			'desktop/assistance-operation-service.ts',
			'desktop/assistance-workflow-service.ts',
			'desktop/assistance-runtime-family-manifest.ts',
			'src/common/editor/assistance/workflow.ts',
			'src/common/editor/controller/assistance/internal/guided/local-assistance-guided-result-acceptance.ts',
			'desktop/assistance-sherpa-recognizer.ts',
			'src/common/editor/ui/local-model-manager-menu.ts',
			'src/common/editor/ui/local-assistance-menu.ts',
			'src/common/editor/controller/assistance/internal/local-assistance-transcript-acceptance.ts',
			'tests/audio-editor-local-assistance-transcript-acceptance.test.ts',
		]) assert.ok(surface.evidence.includes(path), `${productId} is missing ${path}`);
	}
});

test('all-model GPU control retains authenticated runtime and adapter evidence', async () => {
	const matrix = await readJson('config/production-security-matrix.json');
	const control = matrix.risks.flatMap(({ currentControls }) => currentControls)
		.find(({ id }) => id === 'authenticated-local-assistance-gpu-execution');
	assert.ok(control);
	for (const path of [
		'desktop/assistance-sherpa-acceleration.ts',
		'scripts/lib/desktop-assistance-sherpa-gpu-runtime.mjs',
		'scripts/lib/desktop-assistance-onnx-webgpu-binding.mjs',
		'scripts/lib/desktop-assistance-onnx-native-closure.mjs',
		'config/assistance-sherpa-gpu-build.json',
		'config/assistance-onnx-node-api-build.json',
		'config/assistance-onnx-webgpu-plugin.json',
		'tests/desktop-assistance-sherpa-gpu-adapters.test.ts',
		'tests/desktop-assistance-all-model-gpu-capabilities.test.ts',
		'desktop/assistance_kokoro_g2p_gpu.py',
		'native/assistance-kokoro-g2p-gpu/ort-gemm.cc',
		'config/assistance-kokoro-g2p-gpu-build.json',
		'tests/desktop-kokoro-g2p-gpu.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
});
