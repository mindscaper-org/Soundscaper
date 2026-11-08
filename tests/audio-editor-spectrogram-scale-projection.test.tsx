/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { ComponentCopyProvider } from '@soundscaper/design-system/contexts/ComponentCopyContext';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import TrackDisplayPreferencesPage from '../src/common/editor/ui/dialogs/TrackDisplayPreferencesPage.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { spectrogramScaleProject } from './helpers/spectrogram-scale-fixture.ts';

const SCALES = ['mel', 'linear', 'log', 'bark', 'erb', 'period'] as const;
type Scale = typeof SCALES[number] | 'logarithmic';
type Target = 'selected track' | 'defaults';

for (const target of ['selected track', 'defaults'] as const) for (const scale of SCALES) {
	test(`${target} Preferences reports the supported ${scale} scale without substituting Mel`, async () => {
		const f = await fixture(target, scale);
		try {
			const selected = f.scale().options.filter(option => option.selected);
			assert.deepEqual(selected.map(option => option.value), [scale]);
			assert.equal(selected[0]?.textContent, {
				mel: 'Mel', linear: 'Linear', log: 'Logarithmic', bark: 'Bark', erb: 'ERB', period: 'Periode',
			}[scale]);
		} finally { await f.unmount(); }
	});
}

for (const target of ['selected track', 'defaults'] as const) {
	test(`${target} Preferences reports the supported logarithmic alias without rewriting it`, async () => {
		const f = await fixture(target, 'logarithmic');
		try {
			const selected = f.scale().options.filter(option => option.selected);
			assert.deepEqual(selected.map(option => option.value), ['log']);
			assert.equal(selected[0]?.textContent, 'Logarithmic');
			assert.deepEqual(f.writes, [], 'viewing a retained alias does not mutate its owner');
		} finally { await f.unmount(); }
	});
}

for (const target of ['selected track', 'defaults'] as const) {
	test(`${target} scale edits target the existing owner and survive reopening`, async () => {
		const f = await fixture(target, 'mel');
		try {
			assert.deepEqual(f.scale().options.map(option => option.value), [...SCALES]);
			await act(async () => { reactProps(f.scale()).onChange({ currentTarget: { value: 'erb' } }); });
			assert.deepEqual(f.writes, [{ target, scale: 'erb' }]);
			assert.equal(f.otherScale(), 'linear', 'the independent track/default setting must survive');
			await f.reopen();
			assert.deepEqual(f.scale().options.filter(option => option.selected).map(option => option.value), ['erb']);
		} finally { await f.unmount(); }
	});
}

async function fixture(target: Target, initialScale: Scale) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const initial = createAudioEditorPreferencesV1();
	let savedDefault: string = target === 'defaults' ? initialScale : 'linear';
	let savedTrack: string = target === 'selected track' ? initialScale : 'linear';
	const { project, track: nativeTrack } = spectrogramScaleProject(savedTrack);
	const writes: { target: Target; scale: string }[] = [];
	type Patch = Readonly<{ spectrogram: Readonly<{ scale: string }> }>;
	function Page() {
		const [defaults, setDefaults] = useState(savedDefault);
		const [track, setTrack] = useState(savedTrack);
		const preferences = { ...initial, spectrogram: { ...initial.spectrogram, scale: defaults } };
		return <ComponentCopyProvider copy={{ period: 'Periode' }} locale="de">
			<TrackDisplayPreferencesPage copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
				controller={{ actions: {
					preferences: { update: (patch: Patch) => {
						assert.equal(typeof patch.spectrogram.scale, 'string');
						savedDefault = String(patch.spectrogram.scale);
						writes.push({ target: 'defaults', scale: savedDefault }); setDefaults(savedDefault);
					} },
					track: { update: (id: string, patch: Patch) => {
						assert.equal(id, nativeTrack.id); assert.equal(typeof patch.spectrogram.scale, 'string');
						savedTrack = String(patch.spectrogram.scale);
						writes.push({ target: 'selected track', scale: savedTrack }); setTrack(savedTrack);
					} },
				} }} snapshot={{ preferences, capabilities: { audioSpectralEditing: true },
					project: { ...project, tracks: [{ ...nativeTrack,
						spectrogram: { ...nativeTrack.spectrogram, scale: track } }] },
					selectedTrackId: target === 'defaults' ? null : nativeTrack.id }} />
		</ComponentCopyProvider>;
	}
	await act(async () => root.render(<Page />));
	return {
		writes,
		scale() {
			const element = dom.container.querySelectorAll('select').find(node => node.getAttribute('aria-label') === ENGLISH_COPY.spectrogramScale);
			assert.ok(element); return element;
		},
		otherScale: () => target === 'defaults' ? savedTrack : savedDefault,
		async reopen() { await act(async () => root.render(<Page key="reopened" />)); },
		async unmount() {
			await act(async () => root.unmount());
			globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
		},
	};
}
