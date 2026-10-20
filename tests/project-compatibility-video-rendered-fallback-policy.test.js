/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('compatibility policy qualifies a generic whole-project video role and first-party clip role', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-video-rendered-fallback-playback');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');

	for (const reference of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	for (const reference of [
		'src/common/editor/project-feature-video-rendered-fallback.ts',
		'src/common/editor/project-feature-video-clip-render-v1.ts',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-audio.ts',
		'src/common/editor/project-fallback-integrity-video.ts',
		'src/common/editor/controller/source/playback-project-service.ts',
		'src/common/editor/controller/export/internal/audio/audio-rendered-fallback-export.ts',
		'src/common/editor/controller/export/internal/video/video-rendered-fallback-export.ts',
		'src/common/editor/controller/export/internal/video/video-export-service.ts',
		'src/common/editor/controller/export/internal/export-service.ts',
		'src/common/editor/controller/source/source-lifecycle-service.ts',
		'src/common/editor/controller/document/project-switch-service.ts',
		'src/common/editor/controller/document/project-visual-service.ts',
		'src/common/editor/controller/document/document-snapshot.ts',
		'src/common/editor/ui/workspace/video-preview-visual.ts',
		'src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'tests/audio-editor-project-feature-video-rendered-fallback.test.ts',
		'tests/audio-editor-project-feature-video-clip-render-v1.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
		'tests/audio-editor-project-fallback-integrity-selection.test.ts',
		'tests/audio-editor-project-fallback-integrity-mixed-selection.test.ts',
		'tests/audio-editor-video-rendered-fallback-delivery-projection.test.ts',
		'tests/audio-editor-video-rendered-fallback-export.test.ts',
		'tests/audio-editor-mixed-rendered-fallback-video-export.test.ts',
		'tests/audio-editor-project-visual-service.test.ts',
		'tests/audio-editor-video-clip-fallback-export-regression.test.ts',
		'tests/audio-editor-project-switch-source-preparation.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
		'tests/audio-editor-video-preview-visual.test.ts',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/audio-editor-framescaper-baseline.test.ts',
		'tests/audio-editor-scape-video-clip-fallback-roundtrip.test.ts',
	]) assert.ok(rule.evidence.includes(reference), reference);
});
