/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import type { UnifiedExactRenderFinishingNode } from '../src/common/editor/unified-exact-render-plan.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const PROFILE = FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE;

test('the unused Framescaper native delivery bundle constructor is absent from the source tree', async () => {
	const builder = new URL('../src/framescaper/editor-project-unified-render-delivery.ts', import.meta.url);
	await assert.rejects(access(builder), { code: 'ENOENT' });
});

test('the retired detached companion audio constructor is absent', async () => {
	const scope = await import('../src/framescaper/editor-project-companion-audio-scope.ts');
	assert.equal(Object.hasOwn(scope, 'createFramescaperCompanionAudioProjectScopeV15'), false);
});

test('the picture plan binds programme audio and preserves the complete canonical selection', () => {
	const project = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options());
	const selection = structuredClone(project.selection);
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);

	assert.deepEqual(selection, {
		startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], annotationIds: [], frequencyRange: null,
	});
	assert.deepEqual(project.selection, selection);
	const finishing = plan.nodes.find((node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing');
	assert.ok(finishing);
	assert.deepEqual(finishing.audioContext.audioTracks.map(({ id }) => id), ['audio-track']);
	assert.deepEqual(finishing.audioContext.mixer.outputs, project.mixer.outputs);
});
