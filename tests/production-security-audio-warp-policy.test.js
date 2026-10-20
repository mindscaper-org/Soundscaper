/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('audio-warp admission control retains its runtime and round-trip evidence', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'audio-warp-native-and-cross-product-admission',
	);
	assert.ok(control);
	assertEvidence(control, [
		'src/common/editor/audio-warp-domain.ts',
		'src/common/editor/audio-warp-clip-authority.ts',
		'src/common/editor/audio-warp-runtime.ts',
		'src/common/editor/audio-warp-render-parity.ts',
		'src/soundscaper/editor-project-validation.ts',
		'src/common/editor/runtime-clip-projection.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/engine/audio-warp-fallback.ts',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'tests/audio-editor-foundation-feature-registration.test.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-project-bin-service.test.ts',
		'tests/audio-editor-project-owned-feature-requirements.test.ts',
		'tests/audio-editor-project-feature-audio-rendered-fallback.test.ts',
		'tests/audio-editor-audio-warp-runtime.test.ts',
		'tests/audio-editor-audio-warp-pcm-parity.test.ts',
		'tests/audio-editor-scape-audio-warp-roundtrip.test.ts',
		'tests/desktop-soundscaper-project-library-baseline.test.ts',
		'tests/audio-editor-audio-warp-export-service.test.ts',
		'tests/browser/audio-editor-audio-warp.spec.js',
	]);
});

test('transient analysis control retains its worker, cache, and lifecycle evidence', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'bounded-audio-warp-transient-analysis',
	);
	assert.ok(control);
	assertEvidence(control, [
		'src/common/editor/transient-analysis.ts',
		'src/common/editor/transient-analysis-worker-client.ts',
		'src/common/editor/storage/transient-analysis-cache.ts',
		'src/common/editor/storage/transient-analysis-cache-repository.ts',
		'src/common/editor/storage/derivative-cache-policy.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/retention-repository.ts',
		'src/common/editor/controller/analysis/transient-analysis-service.ts',
		'src/common/editor/controller/analysis/transient-analysis-pcm-access.ts',
		'tests/audio-editor-transient-analysis.test.ts',
		'tests/audio-editor-transient-analysis-worker.test.ts',
		'tests/audio-editor-transient-analysis-service.test.ts',
		'tests/audio-editor-transient-analysis-pcm-access.test.ts',
		'tests/audio-editor-transient-analysis-cache-lifecycle.test.ts',
	]);
});

test('exact audio-warp fallback control retains rendering admission evidence', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'bounded-audio-warp-exact-window-rendering',
	);
	assert.ok(control);
	assertEvidence(control, [
		'src/common/editor/engine/audio-warp-fallback.ts',
		'src/common/editor/engine/audio-warp-playback-scheduler.ts',
		'src/common/editor/engine/offline-render-admission.ts',
		'src/common/editor/engine/rendering.ts',
		'src/common/editor/engine/transport-control.ts',
		'src/common/editor/engine/transport-scheduler.ts',
		'src/common/editor/pcm-sink-admission.ts',
		'tests/audio-editor-audio-warp-engine-status.test.ts',
		'tests/audio-editor-offline-render-admission.test.ts',
	]);
});

function assertEvidence(control, paths) {
	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of paths) assert.equal(evidence.has(path), true, path);
}
