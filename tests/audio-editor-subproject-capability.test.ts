/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { SOUNDSCAPER_PROFILE } from '../src/soundscaper/product.js';
import { FRAMESCAPER_PROFILE } from '../src/framescaper/product.js';
import { assertEditorCommandCapabilities } from '../src/common/editor/controller/document/internal/command-capability-policy.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../src/common/editor/project-owned-feature-requirements.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const FEATURE = 'org.soundscaper.capability.subprojects';
test('subprojects have an explicit Soundscaper capability and reject other product commands', () => {
	assert.equal(PROJECT_FEATURE_CAPABILITY_IDS.subprojects, FEATURE);
	assert.equal(SOUNDSCAPER_PROFILE.capabilities.subprojects, true);
	assert.equal(FRAMESCAPER_PROFILE.capabilities.subprojects, false);
	assert.throws(() => assertEditorCommandCapabilities({ type: 'subproject/detach', expected: {} }, FRAMESCAPER_PROFILE.capabilities, 'Framescaper'), /subprojects/iu);
});

test('subproject state owns a bypassable update requirement while ordinary proxy audio stays canonical', () => {
	const project = createSoundscaperProject();
	const link = { id: 'link', projectId: 'child', libraryId: 'library', title: 'Child', sourceId: 'proxy',
		followLatest: true, revision: 1, contentDigest: 'a'.repeat(64), sampleRate: 48000, channelCount: 2, frameCount: 4 };
	const requirements = reconcileProjectOwnedFeatureRequirements({ ...project, metadata: { ...project.metadata, subprojects: [link] } }, project.featureRequirements);
	assert.deepEqual(requirements.requirements.find(row => row.featureId === FEATURE), {
		id: 'soundscaper.subprojects', featureId: FEATURE, displayName: 'Subprojects', disposition: 'bypass', fallback: null,
	});
});

test('Audacity export explicitly reports flattening linked subprojects to their proxy audio', async () => {
	const { reportAup4OwnedFeatureOmissions } = await import('../src/common/editor/aup4-feature-omissions.ts');
	const items: Readonly<Record<string, unknown>>[] = [];
	const codes = reportAup4OwnedFeatureOmissions({ featureRequirements: { requirements: [{ id: 'soundscaper.subprojects' }] } },
		{ items: [] }, (_report, item) => items.push(item));
	assert.deepEqual(codes, ['SUBPROJECT_LINKS_OMITTED']);
	assert.match(String(items[0]!.message), /proxy audio.*ordinary audio/iu);
});
