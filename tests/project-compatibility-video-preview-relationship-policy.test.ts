/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface CompatibilityRule {
	readonly id: string;
	readonly status: string;
	readonly requiredOutcome: string;
	readonly currentBehavior: string;
	readonly evidence: readonly string[];
}

interface CompatibilityPolicy {
	readonly rules: readonly CompatibilityRule[];
}

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('disposable video previews remain reproducible local relationships, not durable project media', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8')) as CompatibilityPolicy;
	const relationship = policy.rules.find(
		({ id }) => id === 'current-disposable-video-preview-relationship',
	);
	assert.ok(relationship, 'the disposable video-preview relationship rule is required');
	assert.equal(relationship.status, 'implemented');
	for (const evidence of [
		'src/common/editor/storage/video-derivative-relationship.ts',
		'src/common/editor/storage/video-derivative-repository.ts',
		'src/common/editor/controller/import/internal/source-import.ts',
		'src/common/editor/commands/project-source-bin-runtime.js',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-video-derivative-binding.test.ts',
		'tests/audio-editor-source-import.test.ts',
		'tests/audio-editor-project-bin.test.js',
		'tests/audio-editor-scape-project.test.js',
		'tests/audio-editor-feature-requirement-retention.test.ts',
		'tests/audio-editor-scape-feature-requirements.test.ts',
		'tests/audio-editor-scape-video-return-roundtrip.test.ts',
	]) assert.ok(relationship.evidence.includes(evidence), evidence);
});
