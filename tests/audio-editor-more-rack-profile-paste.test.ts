/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { captureAudacityNoiseProfile } from '../src/common/editor/audacity-effects/spectral.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { createRackEffectService, type RackEffectControllerState, type RackEffectProject } from '../src/common/editor/controller/effects/internal/rack-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

function profile(rate: number) {
	return captureAudacityNoiseProfile([Float32Array.from({ length: 4096 }, (_, frame) =>
		.2 * Math.sin(2 * Math.PI * 750 * frame / rate))], rate);
}

for (const recapture of [false, true]) test(`pasting a rack across project sample rates ${recapture ? 'uses a newly captured profile' : 'disables an incompatible noise profile'}`, () => {
	let project = createSoundscaperProject({ id: 'source-project', sampleRate: 24_000,
		tracks: [createAudioTrack({ id: 'track', clipIds: [] }, 24_000)] });
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const state: RackEffectControllerState = { selectedTrackId: 'track', readOnly: false, writeAuthorityGeneration: 0,
		effectClipboard: null, rackEffectGestures: new Map(), parametricEqGestures: new Map(),
		audacityControlTrackId: null, audacityNoiseProfile: profile(24_000) };
	const service = createRackEffectService({ state, engine: {},
		copy: { effectTypeRequired: 'Effect required', selectTrackFirst: 'Track required', audioTrackRequired: 'Audio required',
			effectUnsupported: 'Unsupported', autoDuckOtherControlTrack: 'Control required', noiseReductionAddedDisabled: 'Capture a profile',
			rackEffectNotFound: 'Missing effect', missingEffectReadOnly: 'Read only', projectReadOnly: 'Read only',
			audioTrackNotFound: 'Missing track', paste: 'Paste', noiseProfileMissing: 'Capture a profile' },
		getProject: () => project as unknown as RackEffectProject,
		captureProject: () => generation.capture(project.id), assertProject: token => { generation.assertCurrent(token); },
		editingBlocked: () => false, publishDocumentSnapshot() {}, handleError: error => { throw error; }, setStatus() {},
		commit: command => { project = applySoundscaperProjectCommand(project, command); return project as unknown as RackEffectProject; },
	});
	service.addEffect({ type: 'audacity-noise-reduction', scope: 'track', trackId: 'track' });
	service.copyEffectStack('track', 'track');
	project = createSoundscaperProject({ id: 'destination-project', sampleRate: 48_000,
		tracks: [createAudioTrack({ id: 'track', clipIds: [] }, 48_000)] });
	generation.activate(project.id);
	// Opening a project resets the profile while retaining the effect clipboard.
	state.audacityNoiseProfile = recapture ? profile(48_000) : null;
	const pasted = service.pasteEffectStack('track', 'track');
	assert.ok(pasted?.[0]);
	const effect = pasted[0];
	assert.equal(effect.enabled, recapture, 'an enabled rack must use a profile matching its playback rate');
	if (recapture) assert.doesNotThrow(() => createAudacityLiveProcessor('audacity-noise-reduction', 48_000,
		effect.params, { noiseProfile: effect.context?.noiseProfile }));
	else assert.equal(pasted?.[0]?.context?.noiseProfile, null);
	assert.equal(state.effectClipboard?.[0]?.context?.noiseProfile &&
		(state.effectClipboard[0].context.noiseProfile as { sampleRate: number }).sampleRate, 24_000,
	'the source clipboard remains reusable in its original project');
});
