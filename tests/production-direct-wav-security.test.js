/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('direct PCM security controls stay limited to WAV, AIFF, BWF, and admitted BW64 routes', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const exactDirectPcm = findControl(matrix, 'desktop-write-path-capabilities', 'exact-direct-pcm-mix-save');
	const directPcmRollback = findControl(matrix, 'long-job-cancellation', 'direct-pcm-mix-save-rollback');
	const controllerIoBoundary = matrix.boundaries.find(({ id }) => id === 'controller-task-to-io');
	assert.ok(controllerIoBoundary, 'controller-task-to-io');

	for (const path of [
		'desktop/validation.js',
		'desktop/save-targets.js',
		'desktop/preload.mjs',
		'desktop/direct-wav-smoke.js',
		'desktop/direct-wav-renderer-smoke.js',
		'src/common/editor/aiff.js',
		'src/common/editor/wav.js',
		'src/common/editor/export.js',
		'src/common/editor/adm-riff-passthrough.ts',
		'src/common/editor/controller/export/internal/direct/direct-aiff-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-bw64-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-bwf-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-export-dispatch.ts',
		'src/common/editor/controller/export/internal/direct/direct-pcm-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-wav-export.ts',
		'src/common/editor/controller/export/internal/export-service.ts',
		'src/common/editor/controller/export/internal/realtime-export-pcm-transform.ts',
		'src/common/editor/engine/clip-scheduler.ts',
		'src/common/editor/engine/public-api.ts',
		'src/common/editor/engine/rendering.ts',
		'src/common/editor/file-save-stream.ts',
		'src/common/editor/pcm-sink.js',
		'scripts/lib/desktop-direct-wav-smoke.mjs',
		'scripts/lib/desktop-direct-wav-smoke-evidence.mjs',
		'scripts/lib/desktop-direct-wav-staging-observer.mjs',
		'scripts/lib/desktop-direct-wav-pcm-signal.mjs',
		'scripts/lib/desktop-direct-aiff-smoke-file.mjs',
		'scripts/lib/desktop-direct-bwf-smoke-file.mjs',
		'scripts/lib/desktop-direct-bw64-smoke-file.mjs',
		'tests/audio-editor-aiff-layout.test.ts',
		'tests/audio-editor-bwf-wav.test.js',
		'tests/audio-editor-export-direct-aiff.test.ts',
		'tests/audio-editor-export-direct-bw64.test.ts',
		'tests/audio-editor-export-direct-bw64-passthrough.test.ts',
		'tests/audio-editor-export-direct-bwf.test.ts',
		'tests/audio-editor-export-direct-wav.test.ts',
		'tests/audio-editor-export-direct-wav-reference.test.ts',
		'tests/audio-editor-rf64-wav.test.ts',
		'tests/helpers/direct-pcm-export-fixture.ts',
		'tests/audio-editor-realtime-export-pcm-transform.test.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/audio-editor-pcm-sink.test.js',
		'tests/audio-editor-realtime-stream-underrun.test.ts',
		'tests/desktop-pcm-mix-save-purpose.test.js',
		'tests/browser/audio-editor-direct-wav-save.spec.js',
		'tests/browser/audio-editor-direct-bw64-passthrough.spec.js',
		'tests/browser/helpers/direct-pcm-save-target.js',
		'tests/desktop-direct-wav-smoke-probe.test.js',
		'tests/desktop-direct-wav-smoke.test.js',
		'tests/desktop-direct-wav-pcm-signal.test.js',
		'tests/desktop-direct-aiff-smoke-file.test.js',
		'tests/desktop-direct-bwf-smoke-file.test.js',
		'tests/desktop-direct-bwf-smoke-protocol.test.js',
		'tests/desktop-direct-bw64-smoke-file.test.js',
		'tests/desktop-direct-bw64-smoke-protocol.test.js',
		'tests/desktop-direct-wav-workflow.test.js',
		'tests/desktop-smoke-probe.test.js',
		'tests/helpers/desktop-direct-bwf-file-evidence.js',
		'tests/helpers/desktop-direct-bw64-file-evidence.js',
		'tests/helpers/desktop-direct-wav-renderer-scope.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(exactDirectPcm.evidence.some((item) => item.path === path), path);
	for (const path of [
		'src/common/editor/controller/export/internal/direct/direct-aiff-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-bw64-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-bwf-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-export-dispatch.ts',
		'src/common/editor/controller/export/internal/direct/direct-pcm-export.ts',
	]) assert.ok(controllerIoBoundary.entryPoints.includes(path), path);
	for (const path of [
		'src/common/editor/controller/export/internal/direct/direct-aiff-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-bw64-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-bwf-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-export-dispatch.ts',
		'src/common/editor/controller/export/internal/direct/direct-pcm-export.ts',
		'tests/audio-editor-export-direct-aiff.test.ts',
		'tests/audio-editor-export-direct-bw64.test.ts',
		'tests/audio-editor-export-direct-bw64-passthrough.test.ts',
		'tests/audio-editor-export-direct-bwf.test.ts',
		'tests/browser/audio-editor-direct-wav-save.spec.js',
		'tests/browser/audio-editor-direct-bw64-passthrough.spec.js',
		'tests/browser/helpers/direct-pcm-save-target.js',
		'tests/audio-editor-export-direct-wav-reference.test.ts',
		'desktop/direct-wav-smoke.js',
		'desktop/direct-wav-renderer-smoke.js',
		'scripts/lib/desktop-direct-wav-smoke.mjs',
		'scripts/lib/desktop-direct-bwf-smoke-file.mjs',
		'scripts/lib/desktop-direct-bw64-smoke-file.mjs',
		'tests/desktop-direct-wav-smoke-probe.test.js',
		'tests/desktop-direct-wav-smoke.test.js',
		'tests/desktop-direct-bwf-smoke-file.test.js',
		'tests/desktop-direct-bwf-smoke-protocol.test.js',
		'tests/desktop-direct-bw64-smoke-file.test.js',
		'tests/desktop-direct-bw64-smoke-protocol.test.js',
		'tests/desktop-direct-wav-workflow.test.js',
		'tests/desktop-smoke-probe.test.js',
		'tests/helpers/desktop-direct-bwf-file-evidence.js',
		'tests/helpers/desktop-direct-bw64-file-evidence.js',
		'tests/helpers/desktop-direct-wav-renderer-scope.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(controllerIoBoundary.evidence.some((item) => item.path === path), path);

	for (const path of [
		'src/common/editor/controller/export/internal/direct/direct-aiff-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-bw64-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-bwf-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-export-dispatch.ts',
		'src/common/editor/controller/export/internal/direct/direct-pcm-export.ts',
		'src/common/editor/controller/export/internal/direct/direct-wav-export.ts',
		'src/common/editor/controller/export/internal/export-service.ts',
		'src/common/editor/engine/clip-scheduler.ts',
		'src/common/editor/engine/public-api.ts',
		'src/common/editor/engine/rendering.ts',
		'src/common/editor/file-save-stream.ts',
		'src/common/editor/pcm-sink.js',
		'desktop/save-targets.js',
		'desktop/direct-wav-smoke.js',
		'desktop/direct-wav-renderer-smoke.js',
		'scripts/lib/desktop-direct-wav-smoke.mjs',
		'scripts/lib/desktop-direct-wav-smoke-evidence.mjs',
		'scripts/lib/desktop-direct-wav-staging-observer.mjs',
		'scripts/lib/desktop-direct-bw64-smoke-file.mjs',
		'tests/audio-editor-export-direct-aiff.test.ts',
		'tests/audio-editor-export-direct-bw64.test.ts',
		'tests/audio-editor-export-direct-bwf.test.ts',
		'tests/audio-editor-export-direct-wav.test.ts',
		'tests/audio-editor-export-direct-wav-reference.test.ts',
		'tests/helpers/direct-pcm-export-fixture.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/audio-editor-pcm-sink.test.js',
		'tests/audio-editor-realtime-stream-underrun.test.ts',
		'tests/browser/audio-editor-direct-wav-save.spec.js',
		'tests/browser/audio-editor-direct-bw64-passthrough.spec.js',
		'tests/browser/helpers/direct-pcm-save-target.js',
		'tests/desktop-direct-wav-smoke-probe.test.js',
		'tests/desktop-direct-wav-smoke.test.js',
		'tests/desktop-direct-aiff-smoke-file.test.js',
		'tests/desktop-direct-bw64-smoke-file.test.js',
		'tests/desktop-direct-bw64-smoke-protocol.test.js',
		'tests/desktop-direct-wav-workflow.test.js',
		'tests/helpers/desktop-direct-wav-renderer-scope.js',
		'tests/helpers/desktop-direct-bw64-file-evidence.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(directPcmRollback.evidence.some((item) => item.path === path), path);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, `${riskId}/${controlId}`);
	return control;
}
