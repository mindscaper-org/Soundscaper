/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('compatibility policy qualifies role-defined audio whole-mix fallback playback and delivery', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-audio-whole-mix-rendered-fallback');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');

	for (const reference of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	for (const reference of [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-audio-rendered-fallback.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-audio.ts',
		'src/common/editor/controller/source/playback-project-service.ts',
		'src/common/editor/controller/document/project-admin-service.ts',
		'src/common/editor/controller/export/internal/audio/audio-rendered-fallback-export.ts',
		'src/common/editor/controller/export/internal/export-service.ts',
		'src/common/editor/controller/source/source-lifecycle-service.ts',
		'src/common/editor/controller/source/source-audio.ts',
		'src/common/editor/retention.js',
		'src/framescaper/desktop-project-library-body-transfer.ts',
		'desktop/soundscaper-project-library-transfer-service.ts',
		'src/soundscaper/desktop-project-library-renderer.ts',
		'tests/audio-editor-project-feature-audio-rendered-fallback.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
		'tests/audio-editor-audio-rendered-fallback-delivery-projection.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export-service.test.ts',
		'tests/audio-editor-project-fallback-integrity-audio-selection.test.ts',
		'tests/audio-editor-project-fallback-integrity-audio-provider.test.ts',
		'tests/audio-editor-project-fallback-integrity-mixed-selection.test.ts',
		'tests/audio-editor-mixed-rendered-fallback-video-export.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
		'tests/audio-editor-source-audio.test.ts',
		'tests/audio-editor-required-source-preparation.test.ts',
		'tests/audio-editor-project-switch-source-preparation.test.ts',
		'tests/audio-editor-project-switch-playback-apply.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]) assert.ok(rule.evidence.includes(reference), reference);
});
