/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('role-defined whole-project and first-party clip-local video fallback playback stay narrow', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'video-rendered-fallback-playback',
	);
	assert.ok(control);
	assert.equal(projectDocuments?.currentControls.some(
		({ id }) => id === 'first-party-video-rendered-fallback-playback',
	), false);
	for (const path of [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-video-rendered-fallback.ts',
		'src/common/editor/project-feature-video-clip-render-v1.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/controller/source/playback-project-service.ts',
		'src/common/editor/controller/document/project-switch-service.ts',
		'src/common/editor/controller/source/source-lifecycle-service.ts',
		'src/common/editor/controller/document/project-visual-service.ts',
		'src/common/editor/controller/document/document-snapshot.ts',
		'src/common/editor/project-feature-report-metadata.ts',
		'src/common/editor/session.js',
		'src/common/editor/ui/workspace/video-preview-visual.ts',
		'src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx',
		'src/common/editor/app.js',
		'tests/audio-editor-project-feature-video-rendered-fallback.test.ts',
		'tests/audio-editor-project-feature-video-clip-render-v1.test.ts',
		'tests/audio-editor-project-fallback-integrity.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
		'tests/audio-editor-project-switch-source-preparation.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
		'tests/audio-editor-project-visual-service.test.ts',
		'tests/audio-editor-video-preview-visual.test.ts',
		'tests/audio-editor-document-snapshot.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/audio-editor-framescaper-baseline.test.ts',
		'tests/production-security-video-rendered-fallback.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
});
