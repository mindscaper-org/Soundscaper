/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const CONTROL_ID = 'maintained-save-kindful-linked-original-binding-reachability';

test('the security matrix qualifies maintained save- and activation-triggered linked-original cleanup narrowly', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(({ id }) => id === CONTROL_ID);
	assert.ok(control);

	for (const path of [
		'src/common/editor/app.js',
		'src/common/editor/session.js',
		'src/common/editor/controller/document/project-admin-service.ts',
		'src/common/editor/controller/document/internal/project/project-retention-service.ts',
		'src/common/editor/controller/document/project-save-service.ts',
		'src/common/editor/controller/document/project-switch-service.ts',
		'src/soundscaper/desktop-project-library-renderer.ts',
		'src/common/editor/storage/linked-original-lifecycle-coordinator.ts',
		'src/common/editor/storage/linked-original-pair-writer.ts',
		'src/common/editor/storage/linked-original-project-binding-prune.ts',
		'src/common/editor/storage/linked-original-project-open-maintenance.ts',
		'src/common/editor/storage/linked-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-original-project-save.ts',
		'src/common/editor/storage/linked-original-provisional-root.ts',
		'src/common/editor/storage/linked-original-store-service.ts',
		'src/common/editor/storage/linked-original-transient-binding-reference.ts',
		'src/common/editor/storage/linked-video-original-lifecycle-coordinator.ts',
		'src/common/editor/storage/linked-video-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-video-original-project-save.ts',
		'src/common/editor/storage/project-publication-options.ts',
		'src/common/editor/storage/project-repository.ts',
		'src/common/editor/storage.js',
		'tests/audio-editor-linked-video-project-save-lifecycle.test.ts',
		'tests/audio-editor-linked-audio-project-save-reconciliation.test.ts',
		'tests/audio-editor-linked-original-lifecycle.test.ts',
		'tests/audio-editor-linked-original-project-save.test.ts',
		'tests/audio-editor-linked-original-project-open-maintenance.test.ts',
		'tests/audio-editor-linked-original-provisional-root-reachability.test.ts',
		'tests/audio-editor-linked-original-provisional-root-startup.test.ts',
		'tests/audio-editor-linked-original-provisional-root-writers.test.ts',
		'tests/audio-editor-linked-original-provisional-root.test.ts',
		'tests/audio-editor-linked-original-transient-binding-reference.test.ts',
		'tests/audio-editor-project-switch-playback-apply.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-linked-video-project-reachability-repository.test.ts',
		'tests/audio-editor-linked-video-project-save-lifecycle.test.ts',
		'tests/audio-editor-linked-video-project-save-reconciliation.test.ts',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/audio-editor-project-retention-service.test.ts',
		'tests/audio-editor-project-save-options.test.ts',
		'tests/audio-editor-project-services.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/browser/audio-editor-storage-publication.spec.js',
		'tests/production-security-linked-video-save-cleanup.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
});
