/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('the compatibility register binds the family-v1 baseline to current implementation evidence', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rules = new Map(policy.rules.map((rule) => [rule.id, rule]));
	const legacySchema = rules.get('pre-release-reimport-required');
	const currentSchema = rules.get('current-schema-editing');
	const trackLocking = rules.get('current-track-locking');
	const timelineAnnotations = rules.get('current-timeline-annotation-capability');
	const trackFolders = rules.get('current-track-folder-capability');
	const sourceCharacteristics = rules.get('current-source-characteristics-capability');

	assert.deepEqual(
		policy.projectSchema.baselines.map(({ schemaFamily, currentVersion, retainedMigrationSources }) => ({
			schemaFamily, currentVersion, retainedMigrationSources,
		})),
		[
			{ schemaFamily: 'soundscaper', currentVersion: 1, retainedMigrationSources: [] },
			{ schemaFamily: 'framescaper', currentVersion: 1, retainedMigrationSources: [] },
		],
	);
	assert.deepEqual(policy.schemaRetirement.currentMinimumVersions, {
		soundscaper: 1, framescaper: 1,
	});
	assert.ok(legacySchema.evidence.includes('tests/audio-editor-project-schema-identity.test.ts'));
	assert.deepEqual(currentSchema.evidence, [
		'src/common/editor/project-schema-identity.ts',
		'src/soundscaper/editor-project.ts',
		'src/framescaper/editor-project.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-project-schema-identity.test.ts',
		'tests/audio-editor-scape-v1-baseline.test.ts',
	]);
	assert.equal(trackLocking.status, 'implemented');
	assert.deepEqual(trackLocking.evidence, [
		'src/common/editor/project-structure-factory.ts',
		'src/common/editor/project-track-lock-validation.ts',
		'src/common/editor/commands/track-lock-admission.ts',
		'src/common/editor/commands.js',
		'src/common/editor/ui/timeline/timeline-menu-model.js',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-track-lock-admission.test.ts',
		'tests/audio-editor-track-lock-batch.test.ts',
		'tests/audio-editor-track-lock-overflow-menu.test.tsx',
		'tests/audio-editor-scape-project.test.js',
		'tests/desktop-soundscaper-project-library-baseline.test.ts',
		'tests/browser/audio-editor-track-lock.spec.js',
	]);
	assert.equal(sourceCharacteristics.status, 'implemented');
	assert.deepEqual(sourceCharacteristics.evidence, [
		'src/common/editor/video-source-characteristics.ts',
		'src/common/editor/source-characteristics-v14.ts',
		'src/common/editor/project-structure-factory.ts',
		'src/soundscaper/editor-project-validation.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'tests/audio-editor-video-source-characteristics.test.ts',
		'tests/audio-editor-source-characteristics-v14.test.ts',
	]);
	assert.deepEqual(trackFolders.evidence, [
		'src/common/editor/project-structure-factory.ts',
		'src/common/editor/project-hierarchy-document-validation.ts',
		'src/common/editor/track-folder-v12.ts',
		'src/common/editor/track-hierarchy-v12.ts',
		'src/common/editor/track-folder-state-projection.ts',
		'src/common/editor/track-folder-media-runtime.ts',
		'src/common/editor/project-command-projection.ts',
		'src/common/editor/project-hierarchy-reconcile.ts',
		'src/common/editor/track-hierarchy-mutation-v12.ts',
		'src/common/editor/folder-bus-v13.ts',
		'src/common/editor/commands/track-folder-runtime.ts',
		'src/common/editor/commands/track-structure-folder-adapter.ts',
		'src/common/editor/controller/edit/internal/clipboard-edit-service.ts',
		'src/common/editor/controller/document/internal/track-folder-service.ts',
		'src/common/editor/controller/document/document-track-folder-snapshot.ts',
		'src/common/editor/controller/document/internal/command-capability-policy.ts',
		'src/common/editor/controller/source/playback-project-service.ts',
		'src/common/editor/controller/export/internal/video/video-export-service.ts',
		'src/common/editor/controller/export/video-export-timing.ts',
		'src/common/editor/video-export.js',
		'src/common/editor/video-timeline.js',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-track-hierarchy-mutation-v12.test.ts',
		'tests/audio-editor-folder-bus-v13.test.ts',
		'tests/audio-editor-track-folder-commands.test.ts',
		'tests/audio-editor-track-folder-legacy-commands.test.ts',
		'tests/audio-editor-clipboard-edit-service.test.ts',
		'tests/audio-editor-track-folder-roundtrip.test.ts',
		'tests/audio-editor-track-folder-adm.test.ts',
		'tests/audio-editor-track-folder-service.test.ts',
		'tests/audio-editor-track-folder-state-projection.test.ts',
		'tests/audio-editor-track-folder-media-runtime.test.ts',
		'tests/desktop-soundscaper-project-library-baseline.test.ts',
	]);
	for (const path of [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/timeline-annotation.ts',
		'src/common/editor/commands/protocol.ts',
		'src/common/editor/commands/timeline-annotation-runtime.ts',
		'src/common/editor/commands/timeline-annotation-ripple.ts',
		'src/common/editor/commands/timeline-annotation-clipboard.ts',
		'src/common/editor/runtime-timeline-annotation-projection.ts',
		'src/common/editor/controller/document/internal/command-capability-policy.ts',
		'src/common/editor/controller/document/internal/annotations/timeline-annotation-service.ts',
		'src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx',
		'src/common/editor/ui/timeline/TimelineAnnotationPanel.jsx',
		'src/common/editor/audacity-annotation-interchange.ts',
		'src/common/editor/aup4-annotation-interchange.ts',
		'src/common/editor/timeline-annotation-riff-interchange.ts',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'tests/audio-editor-timeline-annotation-command-integration.test.ts',
		'tests/audio-editor-timeline-annotation-feature-registration.test.ts',
		'tests/audio-editor-local-assistance-shot-acceptance.test.ts',
		'tests/audio-editor-timeline-annotation-ripple.test.ts',
		'tests/audio-editor-timeline-annotation-clipboard.test.ts',
		'tests/audio-editor-timeline-annotation-service.test.ts',
		'tests/audio-editor-timeline-annotation-components.test.tsx',
		'tests/audio-editor-audacity-annotation-interchange.test.ts',
		'tests/audio-editor-timeline-annotation-riff-interchange.test.ts',
		'tests/audio-editor-scape-project.test.js',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/browser/audio-editor-timeline-annotations.spec.js',
	]) assert.ok(timelineAnnotations.evidence.includes(path), path);
});
