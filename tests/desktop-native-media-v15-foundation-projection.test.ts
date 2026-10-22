/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCompanionAudioProjectScopeV15 } from '../src/framescaper/editor-project-companion-audio-scope.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const PROFILE = FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE;

test('a companion-audio scope retains the complete empty selection contract', () => {
	const project = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options());
	const scope = createFramescaperCompanionAudioProjectScopeV15(project, 'main-sequence');

	assert.deepEqual(scope.project.selection, {
		startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], annotationIds: [], frequencyRange: null,
	});
});
