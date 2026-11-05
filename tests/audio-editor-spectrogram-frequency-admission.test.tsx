/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';

import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import TrackDisplayPreferencesPage from '../src/common/editor/ui/dialogs/TrackDisplayPreferencesPage.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const target of ['defaults', 'selected track'] as const) {
	test(`${target} spectrogram frequency rejection restores the saved draft before another valid edit`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousReact = globals.React; const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const preferences = createAudioEditorPreferencesV1();
		const maximumFrequency = target === 'defaults' ? 20_000 : 3500;
		let savedMinimum = 3000;
		const writes: Readonly<{ target: string; minimumFrequency: number }>[] = [];
		function Page() {
			const [minimumFrequency, setMinimum] = useState(savedMinimum);
			const spectrogram = { ...preferences.spectrogram, minimumFrequency, maximumFrequency };
			const update = (destination: string, patch: Readonly<{ spectrogram: { minimumFrequency: number } }>) => {
				savedMinimum = patch.spectrogram.minimumFrequency;
				writes.push({ target: destination, minimumFrequency: savedMinimum });
				setMinimum(savedMinimum);
			};
			return <TrackDisplayPreferencesPage copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
				controller={{ actions: {
					preferences: { update: (patch: Parameters<typeof update>[1]) => update('defaults', patch) },
					track: { update: (id: string, patch: Parameters<typeof update>[1]) => update(id, patch) },
				} }}
				snapshot={{ preferences: { ...preferences, spectrogram }, capabilities: { audioSpectralEditing: true },
					project: { sampleRate: 8000, tracks: target === 'defaults' ? [] : [{ id: 'track', type: 'audio', spectrogram }] },
					selectedTrackId: target === 'defaults' ? null : 'track',
				}} />;
		}
		try {
			await act(async () => root.render(<Page />));
			const input = dom.container.querySelectorAll('input')
				.find(candidate => candidate.getAttribute('aria-label') === ENGLISH_COPY.minimumFrequency);
			assert.ok(input);
			await act(async () => reactProps(input).onChange({ currentTarget: { value: target === 'defaults' ? '5000' : '3500' } }));
			await act(async () => reactProps(input).onBlur());
			assert.equal(input.value, '3000', 'a rejected edit must stop presenting itself as the saved value');
			assert.deepEqual(writes, []);
			await act(async () => reactProps(input).onChange({ currentTarget: { value: '3200' } }));
			await act(async () => reactProps(input).onBlur());
			assert.equal(input.value, '3200');
			assert.deepEqual(writes, [{ target: target === 'defaults' ? 'defaults' : 'track', minimumFrequency: 3200 }]);
			await act(async () => root.render(<Page key="reopened" />));
			const reopened = dom.container.querySelectorAll('input')
				.find(candidate => candidate.getAttribute('aria-label') === ENGLISH_COPY.minimumFrequency);
			assert.equal(reopened?.value, '3200', 'reopening agrees with the last accepted edit');
		} finally {
			await act(async () => root.unmount());
			globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
		}
	});
}

test('a higher-rate default minimum cannot make an impossible low-rate maximum appear saved', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React; const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const initial = createAudioEditorPreferencesV1({ spectrogram: { minimumFrequency: 5000, maximumFrequency: 8000 } });
	const writes: unknown[] = [];
	function Page() {
		const [preferences, setPreferences] = useState(initial);
		return <TrackDisplayPreferencesPage copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
			controller={{ actions: { preferences: { update: (patch: Readonly<{ spectrogram: Partial<typeof initial.spectrogram> }>) => {
				writes.push(patch);
				setPreferences(current => ({ ...current, spectrogram: { ...current.spectrogram, ...patch.spectrogram } }));
			} } } }} snapshot={{ preferences, capabilities: { audioSpectralEditing: true },
				project: { sampleRate: 8000, tracks: [] }, selectedTrackId: null }} />;
	}
	try {
		await act(async () => root.render(<Page />));
		const fields = dom.container.querySelectorAll('input');
		const maximum = fields.find(candidate => candidate.getAttribute('aria-label') === ENGLISH_COPY.maximumFrequency);
		const minimum = fields.find(candidate => candidate.getAttribute('aria-label') === ENGLISH_COPY.minimumFrequency);
		assert.ok(maximum); assert.ok(minimum);
		await act(async () => reactProps(maximum).onChange({ currentTarget: { value: '4000' } }));
		await act(async () => reactProps(maximum).onBlur());
		assert.equal(maximum.value, '8000', 'a refused maximum retains the last authored value');
		assert.deepEqual(writes, []);
		await act(async () => reactProps(minimum).onChange({ currentTarget: { value: '3000' } }));
		await act(async () => reactProps(minimum).onBlur());
		await act(async () => reactProps(maximum).onChange({ currentTarget: { value: '4000' } }));
		await act(async () => reactProps(maximum).onBlur());
		assert.deepEqual(writes, [{ spectrogram: { minimumFrequency: 3000 } }, { spectrogram: { maximumFrequency: 4000 } }]);
		assert.equal(minimum.value, '3000'); assert.equal(maximum.value, '4000');
	} finally {
		await act(async () => root.unmount());
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
