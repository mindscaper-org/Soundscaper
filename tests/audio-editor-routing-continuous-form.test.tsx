/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import SoundscaperRoutingGraphInspector from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphInspector.tsx';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY as copy } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

// The mounted DOM delegates validity to this native-number adapter. The paired
// production regression verifies the same stepMismatch with Chromium itself.
function nativeNumbersValid(form: ReactTestElement): boolean {
	return form.querySelectorAll('input').every(input => {
		if (input.type !== 'number') return true;
		if (input.value === '') return !input.hasAttribute('required');
		const value = Number(input.value), minimum = Number(input.getAttribute('min') ?? -Infinity);
		const maximum = Number(input.getAttribute('max') ?? Infinity);
		if (!Number.isFinite(value) || value < minimum || value > maximum) return false;
		const step = input.getAttribute('step');
		if (step === 'any') return true;
		const steps = (value - (Number.isFinite(minimum) ? minimum : 0)) / Number(step ?? 1);
		return Math.abs(steps - Math.round(steps)) < 1e-9;
	});
}

for (const gain of [.5, .123, .000001, 0, 4]) test(`a native VCA gain ${gain} does not block an unrelated rename`, async () => {
	const result = await fixture(gain, 'Renamed control');
	assert.equal(result.savedName, 'Renamed control');
	assert.equal(result.savedGain, gain, 'an untouched continuous gain survives exactly');
	assert.equal(result.step, '0.01', 'the native hundredth spinner is retained after validation');
});

for (const draft of ['-0.01', '4.01', '1e309']) test(`native VCA form still refuses gain ${draft}`, async () => {
	const result = await fixture(.123, 'Renamed control', draft);
	assert.equal(result.savedName, null);
	assert.equal(result.step, '0.01');
});

test('a valid explicit continuous gain edit is saved without rounding', async () => {
	const result = await fixture(.5, 'Renamed control', '.123456789');
	assert.equal(result.savedGain, .123456789);
});

test('an empty optional gain keeps its established zero interpretation', async () => {
	const result = await fixture(.5, '', '');
	assert.equal(result.savedName, '');
	assert.equal(result.savedGain, 0);
});

test('disabled routing controls cannot publish through form submission', async () => {
	const result = await fixture(.123, 'Renamed control', undefined, true);
	assert.equal(result.savedName, null);
});

async function fixture(gain: number, name: string, draft?: string, disabled = false) {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as HTMLElement);
	const base = createSoundscaperProject({ id: 'continuous-routing' });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		vcas: [{ id: 'vca', name: 'Original', gain, mute: false, members: [] }] } });
	const priorFormData = globalThis.FormData;
	class FixtureFormData extends FormData {
		constructor(form?: HTMLFormElement) {
			super();
			for (const input of (form as unknown as ReactTestElement).querySelectorAll('input')) {
				if (input.type !== 'checkbox' || input.checked) this.append(input.name, input.value);
			}
		}
	}
	globalThis.FormData = FixtureFormData;
	let savedName: string | null = null, savedGain: number | null = null;
	try {
		await act(async () => root.render(<SoundscaperRoutingGraphInspector project={project} graph={project.mixer}
			selection={{ kind: 'vca', id: 'vca' }} copy={copy} disabled={disabled} confirmingDelete={false}
			onConfirmingDelete={() => undefined} onError={cause => { throw cause; }} onCandidate={(_kind, candidate) => {
				savedName = candidate.graph.vcas[0]!.name; savedGain = candidate.graph.vcas[0]!.gain;
			}} />));
		const form = dom.one('form');
		const inputs = form.querySelectorAll('input');
		const level = inputs.find(input => input.name === 'gain');
		const title = inputs.find(input => input.name === 'name');
		assert.ok(level && title);
		// Native HTMLInputElement.step reflects its constraint attribute. The
		// small mounted DOM needs that platform reflection supplied explicitly.
		Object.defineProperty(level, 'step', {
			get: () => level.getAttribute('step') ?? '',
			set: (value: string) => level.setAttribute('step', value),
		});
		title.value = name;
		if (draft !== undefined) level.value = draft;
		Object.defineProperty(form, 'reportValidity', { value: () => nativeNumbersValid(form) });
		if (reactProps(form).noValidate || nativeNumbersValid(form)) {
			await act(async () => reactProps(form).onSubmit({ currentTarget: form, preventDefault() {} }));
		}
		return { savedName, savedGain, step: level.getAttribute('step') };
	} finally {
		await act(async () => root.unmount());
		globalThis.FormData = priorFormData;
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}
