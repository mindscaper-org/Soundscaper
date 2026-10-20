/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const compatibilityUrl = new URL('../config/project-compatibility.json', import.meta.url);
const securityUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('linked PCM portability and handoff stay canonical and point-in-time', async () => {
	const policy = await readJson(compatibilityUrl);
	const portable = requiredRule(policy.rules, 'current-linked-pcm-portable-archive');
	const handoff = requiredRule(policy.rules, 'current-desktop-linked-pcm-managed-handoff');
	assert.equal(portable.status, 'implemented');
	assert.equal(handoff.status, 'implemented');
	assert.equal(policy.rules.some(({ id }) => id === 'current-linked-wav-portable-archive'), false);
	assert.equal(policy.rules.some(({ id }) => id === 'current-desktop-linked-wav-managed-handoff'), false);
	for (const path of [
		'src/common/editor/aiff-pcm-chunk-reader.ts',
		'src/common/editor/controller/import/internal/linked-media/linked-audio-import-admission.ts',
		'src/common/editor/storage/linked-audio-original-source-reader.ts',
		'tests/audio-editor-aiff-pcm-chunk-reader.test.ts',
		'tests/audio-editor-linked-wav-import.test.ts',
		'tests/audio-editor-linked-audio-range-source-reader.test.ts',
		'tests/audio-editor-linked-audio-scape-roundtrip.test.ts',
	]) assert.ok(portable.evidence.includes(path) || handoff.evidence.includes(path), path);
	assert.ok(handoff.evidence.includes('tests/desktop-soundscaper-project-library-baseline.test.ts'));
	for (const path of [
		'src/common/editor/app.js',
		'src/common/editor/controller/composition/action-facade.ts',
		'src/common/editor/controller/source/clip-time-pitch-service.ts',
		'src/common/editor/controller/import/internal/linked-media/audio-relink-probe.ts',
		'src/common/editor/controller/import/internal/project-bin/project-bin-linked-audio-relink-service.ts',
		'src/common/editor/controller/import/internal/project-bin/project-bin-linked-original-relink-task.ts',
		'src/common/editor/controller/import/internal/project-bin/project-bin-service.ts',
		'src/common/editor/controller/import/project-bin-types.ts',
		'src/common/editor/controller/document/project-lock-service.ts',
		'src/common/editor/controller/document/project-admin-service.ts',
		'src/common/editor/controller/document/project-switch-service.ts',
		'src/common/editor/controller/source/source-audio.ts',
		'src/common/editor/controller/source/source-chunk-provider-registry.ts',
		'src/common/editor/controller/source/source-lifecycle-service.ts',
		'src/common/editor/storage/linked-original-pair-writer.ts',
		'src/common/editor/storage/linked-original-provisional-root.ts',
		'src/common/editor/storage/project-store-defaults.ts',
		'src/common/editor/storage/source-pcm-read-session.ts',
		'src/common/editor/ui/workspace/ProjectBinPanel.jsx',
		'src/common/editor/ui/workspace/linked-audio-choice-handoff.ts',
		'tests/audio-editor-controller-action-facade.test.ts',
		'tests/audio-editor-clip-time-pitch-service.test.ts',
		'tests/audio-editor-audio-relink-probe.test.ts',
		'tests/audio-editor-linked-audio-original-relink.test.ts',
		'tests/audio-editor-linked-audio-choice-handoff.test.ts',
		'tests/audio-editor-linked-audio-project-bin-ui.test.ts',
		'tests/audio-editor-linked-source-controller-disposal.test.js',
		'tests/audio-editor-project-bin-linked-audio-relink-service.test.ts',
		'tests/audio-editor-project-bin-linked-audio-changed-relink.test.ts',
		'tests/audio-editor-project-bin-service.test.ts',
		'tests/audio-editor-project-lock-service.test.ts',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-source-audio.test.ts',
		'tests/audio-editor-source-chunk-provider-registry.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
	]) assert.ok(handoff.evidence.includes(path), path);
});

test('linked PCM desktop security controls preserve the maintained AIFF profiles', async () => {
	const matrix = await readJson(securityUrl);
	const archiveRisk = requiredRisk(matrix.risks, 'scape-archive-structure-integrity');
	const readRisk = requiredRisk(matrix.risks, 'desktop-read-path-capabilities');
	const libraryRisk = requiredRisk(matrix.risks, 'shared-desktop-project-library-integrity');
	const portability = requiredControl(archiveRisk, 'linked-pcm-canonical-portability');
	const range = requiredControl(readRisk, 'owner-scoped-linked-audio-range-lifecycle');
	const handoff = requiredControl(libraryRisk, 'point-in-time-linked-pcm-managed-handoff');

	assert.equal(archiveRisk.status, 'enforced');
	assert.equal(libraryRisk.status, 'partial');
	for (const path of [
		'src/common/editor/aiff-pcm-chunk-reader.ts',
		'tests/audio-editor-aiff-pcm-chunk-reader.test.ts',
	]) {
		assert.ok(portability.evidence.some((item) => item.path === path), path);
		assert.ok(handoff.evidence.some((item) => item.path === path), path);
	}
	for (const path of [
		'src/common/editor/app.js',
		'src/common/editor/controller/source/clip-time-pitch-service.ts',
		'src/common/editor/controller/document/project-admin-service.ts',
		'src/common/editor/controller/document/project-switch-service.ts',
		'src/common/editor/controller/source/source-audio.ts',
		'src/common/editor/controller/source/source-chunk-provider-registry.ts',
		'src/common/editor/controller/source/source-lifecycle-service.ts',
		'src/common/editor/storage/source-pcm-read-session.ts',
		'tests/audio-editor-clip-time-pitch-service.test.ts',
		'tests/audio-editor-linked-source-controller-disposal.test.js',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-source-audio.test.ts',
		'tests/audio-editor-source-chunk-provider-registry.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
	]) assert.ok(range.evidence.some((item) => item.path === path), path);
	for (const path of [
		'src/common/editor/app.js',
		'src/common/editor/controller/composition/action-facade.ts',
		'src/common/editor/controller/import/internal/linked-media/audio-relink-probe.ts',
		'src/common/editor/controller/import/internal/project-bin/project-bin-linked-audio-relink-service.ts',
		'src/common/editor/controller/import/internal/project-bin/project-bin-linked-original-relink-task.ts',
		'src/common/editor/controller/import/internal/project-bin/project-bin-service.ts',
		'src/common/editor/controller/import/project-bin-types.ts',
		'src/common/editor/controller/document/project-lock-service.ts',
		'src/common/editor/controller/source/source-lifecycle-service.ts',
		'src/common/editor/storage/linked-original-pair-writer.ts',
		'src/common/editor/storage/linked-original-provisional-root.ts',
		'src/common/editor/storage/project-store-defaults.ts',
		'src/common/editor/ui/workspace/ProjectBinPanel.jsx',
		'src/common/editor/ui/workspace/linked-audio-choice-handoff.ts',
		'tests/audio-editor-controller-action-facade.test.ts',
		'tests/audio-editor-audio-relink-probe.test.ts',
		'tests/audio-editor-linked-audio-original-relink.test.ts',
		'tests/audio-editor-linked-audio-choice-handoff.test.ts',
		'tests/audio-editor-linked-audio-project-bin-ui.test.ts',
		'tests/audio-editor-project-bin-linked-audio-relink-service.test.ts',
		'tests/audio-editor-project-bin-linked-audio-changed-relink.test.ts',
		'tests/audio-editor-project-bin-service.test.ts',
		'tests/audio-editor-project-lock-service.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
	]) assert.ok(handoff.evidence.some((item) => item.path === path), path);
});

function requiredRule(rules, id) {
	const rule = rules.find((candidate) => candidate.id === id);
	assert.ok(rule, id);
	return rule;
}

function requiredRisk(risks, id) {
	const risk = risks.find((candidate) => candidate.id === id);
	assert.ok(risk, id);
	return risk;
}

function requiredControl(risk, id) {
	const control = risk.currentControls.find((candidate) => candidate.id === id);
	assert.ok(control, id);
	return control;
}

async function readJson(url) {
	return JSON.parse(await readFile(url, 'utf8'));
}
