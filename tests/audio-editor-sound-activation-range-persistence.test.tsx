/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SoundActivationSettings from '../src/common/editor/ui/SoundActivationSettings.tsx';
import { createSoundActivationPolicyService, type SoundActivationPolicyRecordingState } from '../src/common/editor/controller/recording/sound-activation-policy-service.ts';
import { DEFAULT_SOUND_ACTIVATION_PREFERENCES, type SoundActivationPreferences } from '../src/common/editor/sound-activation-preferences.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const interrupt of [false, true]) {
	test(`sound threshold ${interrupt ? 'stops queued writes when read-only admission changes' : 'keeps native dragging operable and persists its latest admitted value'}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const prior = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let preferences: SoundActivationPreferences = DEFAULT_SOUND_ACTIVATION_PREFERENCES;
		let readOnly = false;
		let render = () => {};
		const state: SoundActivationPolicyRecordingState = { recordingStarting: false, recordingStartPromise: null,
			timedRecordingPreparing: false, timedRecording: null, recorder: null, recordingFinishing: false };
		const writes: number[] = [];
		const replies: (() => void)[] = [];
		const errors: unknown[] = [];
		const service = createSoundActivationPolicyService({ state, getPreferences: () => preferences,
			updatePreferences: patch => new Promise<void>(resolve => {
				writes.push(patch.recording.soundActivation.thresholdDb);
				replies.push(() => { preferences = patch.recording.soundActivation; resolve(); });
			}), publish: () => { render(); } });
		const controller = { actions: { recording: { soundActivation: service } } };
		render = () => root.render(<SoundActivationSettings controller={controller} productId="soundscaper" locale="en"
			copy={ENGLISH_COPY} readOnly={readOnly} soundActivation={service.getSnapshot()} run={operation => {
				const result = operation();
				if (result instanceof Promise) void result.catch((error: unknown) => { errors.push(error); });
				return result;
			}} />);
		try {
			await act(async () => { render(); });
			const threshold = dom.one('[data-sound-activation-threshold]');
			const change = async (value: number) => act(async () => { reactProps(threshold).onChange?.({ currentTarget: { valueAsNumber: value } }); });
			await change(-36);
			assert.deepEqual(writes, [-36], 'the first keyboard or pointer step still begins saving immediately');
			assert.equal(threshold.hasAttribute('disabled'), false, 'its own asynchronous save cannot end the native range drag');
			assert.equal(dom.one('[data-sound-activation-hysteresis]').hasAttribute('disabled'), true, 'other controls still follow preference policy');
			await change(-20); await change(0);
			assert.deepEqual(writes, [-36], 'later motions wait for the admitted save');
			assert.equal(threshold.value, '0');
			assert.equal(threshold.getAttribute('aria-valuetext'), '0 dB');
			if (interrupt) {
				readOnly = true;
				await act(async () => { render(); });
				assert.equal(threshold.hasAttribute('disabled'), true);
			}
			await act(async () => { replies.shift()?.(); });
			assert.deepEqual(writes, interrupt ? [-36] : [-36, 0]);
			if (!interrupt) await act(async () => { replies.shift()?.(); });
			assert.equal(preferences.thresholdDb, interrupt ? -36 : 0);
			assert.equal(service.getSnapshot().preferenceMutationBlocked, false);
			assert.deepEqual(errors, []);
		} finally {
			await act(async () => { for (const reply of replies.splice(0)) reply(); });
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = prior;
			dom.restore();
		}
	});
}
