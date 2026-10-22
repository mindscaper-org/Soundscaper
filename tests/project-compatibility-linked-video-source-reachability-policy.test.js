/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('linked-original compatibility policy qualifies bounded save and activation source reachability', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-kindful-linked-original-save-roots');
	assert.ok(rule);

	for (const evidence of [
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
		'src/common/editor/storage/linked-video-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-video-original-project-save.ts',
		'tests/audio-editor-linked-audio-project-save-reconciliation.test.ts',
		'tests/audio-editor-linked-original-lifecycle.test.ts',
		'tests/audio-editor-linked-original-project-save.test.ts',
		'tests/audio-editor-linked-original-project-open-maintenance.test.ts',
		'tests/audio-editor-linked-original-provisional-root-reachability.test.ts',
		'tests/audio-editor-linked-original-provisional-root-startup.test.ts',
		'tests/audio-editor-linked-original-provisional-root-writers.test.ts',
		'tests/audio-editor-linked-original-provisional-root.test.ts',
		'tests/audio-editor-linked-original-transient-binding-reference.test.ts',
		'tests/audio-editor-linked-video-project-save-lifecycle.test.ts',
		'tests/audio-editor-project-switch-playback-apply.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-project-retention-service.test.ts',
		'tests/audio-editor-linked-video-project-reachability-repository.test.ts',
		'tests/audio-editor-linked-video-project-save-lifecycle.test.ts',
		'tests/audio-editor-linked-video-project-save-reconciliation.test.ts',
		'tests/audio-editor-project-save-options.test.ts',
		'tests/audio-editor-project-services.test.ts',
		'tests/browser/audio-editor-storage-publication.spec.js',
	]) assert.ok(rule.evidence.includes(evidence), `missing compatibility evidence: ${evidence}`);
});
