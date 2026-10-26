/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import EffectParameterEditor from '../src/common/editor/ui/inspector/EffectParameterEditor.jsx';
import { CommitField } from '../src/common/editor/ui/inspector/inspector-controls.jsx';
import { createEffect } from '../src/common/editor/effects.js';
import { standardEffectStateBytes } from '../src/common/editor/first-party-effects/standard/selection-contract.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a rack setting refused by processor admission marks the edited field invalid', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const effect = createEffect('multi-tap-delay', { id: 'delay', params: { echoes: 30 } });
	let attempts = 0;
	try {
		await act(async () => root.render(<EffectParameterEditor effect={effect} copy={ENGLISH_COPY} disabled={false}
			tracks={[]} targetTrackId="voice" sampleRate={48_000} captureNoiseProfile={undefined} noiseProfileLabel=""
			onRackEffectGestureBegin={undefined} onRackEffectPreview={undefined} onRackEffectCommit={undefined} onRackEffectCancel={undefined}
			onParametricEqGestureBegin={undefined} onParametricEqPreview={undefined} onParametricEqCommit={undefined}
			onParametricEqCancel={undefined} onParametricEqAudition={undefined} readParametricEqSpectrum={undefined}
			automationRuntime={undefined} automationProject={undefined} automationStrip={undefined}
			onChange={(changes: { params: Record<string, number> }) => {
				attempts++;
				standardEffectStateBytes('multi-tap-delay', { ...effect.params, ...changes.params }, 48_000, 8);
			}} />));
		const input = dom.one('[data-effect-param="time"]').querySelector('.text-input__field');
		assert.ok(input);
		await act(async () => reactProps(input).onChange({ target: { value: '4' } }));
		await act(async () => reactProps(input).onBlur());
		assert.equal(attempts, 1);
		assert.equal(effect.params.time, .3, 'the refused edit must not become the authored rack value');
		assert.match(dom.one('[role="alert"]').textContent, /64 MiB/u);
		assert.equal(input.getAttribute('aria-invalid'), 'true', 'the draft must not look like an accepted setting');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

test('an older rejected parameter commit cannot invalidate a newer draft', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let rejectCommit: ((reason: Error) => void) | undefined;
	try {
		await act(async () => root.render(<CommitField label="Time" name="time" value=".3" type="number"
			disabled={false} readOnly={false} multiline={false}
			onCommit={() => new Promise<boolean>((_resolve, reject) => { rejectCommit = reject; })} />));
		const input = dom.one('.text-input__field');
		await act(async () => reactProps(input).onChange({ target: { value: '4' } }));
		await act(async () => reactProps(input).onBlur());
		assert.ok(rejectCommit);
		await act(async () => reactProps(input).onChange({ target: { value: '.2' } }));
		await act(async () => rejectCommit?.(new Error('Previous edit refused')));
		assert.equal(input.value, '.2');
		assert.notEqual(input.getAttribute('aria-invalid'), 'true');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
