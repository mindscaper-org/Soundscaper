/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('linked retained-video policy pins exact local lifecycle behavior', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const linkedVideoOriginal = policy.rules.find(
		({ id }) => id === 'current-desktop-linked-retained-video-original',
	);
	assert.ok(linkedVideoOriginal);
	assert.equal(linkedVideoOriginal.status, 'implemented');
	for (const path of [
		'src/common/editor/storage/linked-video-original-binding.ts',
		'src/common/editor/storage/linked-video-original-repository.ts',
		'src/common/editor/storage/linked-video-original-project-alias-repository.ts',
		'src/common/editor/storage/linked-video-original-project-reachability-repository.ts',
		'src/common/editor/storage/linked-video-original-project-save.ts',
		'tests/audio-editor-linked-video-original-binding.test.ts',
		'tests/audio-editor-linked-video-original-repository.test.ts',
		'tests/audio-editor-linked-video-project-duplication.test.ts',
		'tests/audio-editor-linked-video-project-reachability-repository.test.ts',
		'tests/audio-editor-linked-video-project-save-lifecycle.test.ts',
		'desktop/soundscaper-project-library-main.ts',
		'desktop/framescaper-project-library-main.ts',
		'tests/desktop-soundscaper-project-library-baseline.test.ts',
		'tests/desktop-framescaper-project-library-baseline.test.ts',
	]) assert.ok(linkedVideoOriginal.evidence.includes(path), path);
	assert.equal(linkedVideoOriginal.evidence.some((path) => (
		path.includes('desktop-shared-project') || path.includes('desktop/project-library-')
	)), false);
});
