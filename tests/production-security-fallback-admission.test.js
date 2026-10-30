/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('controller fallback admission keeps its byte-integrity claim narrow and evidenced', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	assert.ok(projectDocuments);
	const fallbackAdmission = projectDocuments.currentControls.find(
		({ id }) => id === 'controller-rendered-fallback-admission',
	);
	assert.ok(fallbackAdmission);
	for (const path of [
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-audio.ts',
		'src/common/editor/project-fallback-integrity-snapshot.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/media/content-digest.ts',
		'src/common/editor/storage.js',
		'src/common/editor/storage/source-read-repository.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/media-asset-load-repository.ts',
		'src/common/editor/storage/media-repository.ts',
			'src/common/editor/controller/document/project-switch-service.ts',
			'src/common/editor/controller/export/internal/audio/audio-rendered-fallback-export.ts',
			'src/common/editor/controller/export/internal/video/video-rendered-fallback-export.ts',
			'src/common/editor/controller/export/internal/video/video-export-service.ts',
		'src/common/editor/controller/export/internal/export-service.ts',
		'src/common/editor/session-activation.js',
		'src/common/editor/session.js',
		'src/common/editor/app.js',
		'tests/audio-editor-project-fallback-integrity.test.ts',
		'tests/audio-editor-project-fallback-integrity-relationships.test.ts',
		'tests/audio-editor-project-fallback-integrity-audio-selection.test.ts',
			'tests/audio-editor-project-fallback-integrity-audio-provider.test.ts',
			'tests/audio-editor-project-fallback-integrity-mixed-selection.test.ts',
			'tests/audio-editor-mixed-rendered-fallback-video-export.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export-service.test.ts',
		'tests/audio-editor-source-read-cancellation.test.ts',
		'tests/audio-editor-media-asset-load.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
		'tests/audio-editor-session-project-activation.test.js',
	]) assert.ok(fallbackAdmission.evidence.some((item) => item.path === path), path);
});
