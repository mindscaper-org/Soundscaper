/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import SoundscaperRoutingGraphInspector from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphInspector.tsx';
import type { SoundscaperRoutingParameterGesture } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-gesture.ts';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

const savedLevel = 0.0008;
const graph: MixerGraphV21 = {
	schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
	outputs: [{ id: 'main', name: 'Main output', role: 'main', channelCount: 2 }],
	edges: [
		{ id: 'voice-master', kind: 'assignment', source: { kind: 'track', id: 'voice' },
			destination: { kind: 'master' }, position: 'post-fader', level: savedLevel,
			enabled: true, channelMap: [0, 1] },
		{ id: 'master-main', kind: 'assignment', source: { kind: 'master' },
			destination: { kind: 'output', id: 'main' }, position: 'post-fader', level: 1,
			enabled: true, channelMap: [0, 1] },
	],
};
const project = { schemaVersion: 21, masterChannels: 2, master: { effects: [] },
	tracks: [{ id: 'voice', type: 'audio', name: 'Voice', effects: [] }],
	trackFolders: [], sequences: [], mixer: graph };

async function withInspector(capture: boolean | Promise<boolean>, run: (fixture: Readonly<{
	level: ReactTestElement;
	submit: () => Promise<void>;
	gestures: SoundscaperRoutingParameterGesture[];
	levels: number[];
}>) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const priorFormData = Object.getOwnPropertyDescriptor(globalThis, 'FormData');
	const NativeFormData = globalThis.FormData;
	const root = createRoot(dom.container as unknown as Element);
	const gestures: SoundscaperRoutingParameterGesture[] = [];
	const levels: number[] = [];
	const errors: unknown[] = [];
	// Node's FormData does not accept a form. Preserve native successful-control
	// serialization while supplying the mounted test DOM's input/select values.
	Object.defineProperty(globalThis, 'FormData', { configurable: true,
		value: class extends NativeFormData {
			constructor(form: ReactTestElement) {
				super();
				for (const control of form.querySelectorAll('input, select')) {
					if (!control.name || control.disabled || (control.type === 'checkbox' && !control.checked)) continue;
					const value = control.tagName === 'SELECT'
						? control.options.find(option => option.selected)?.value ?? control.value : control.value;
					this.append(control.name, value);
				}
			}
		},
	});
	try {
		await act(async () => root.render(<SoundscaperRoutingGraphInspector
			project={project} graph={graph} copy={SOUNDSCAPER_ROUTING_GRAPH_COPY}
			selection={{ kind: 'edge', id: 'voice-master' }} disabled={false} confirmingDelete={false}
			onConfirmingDelete={() => undefined} onError={reason => { errors.push(reason); }}
			onCandidate={(_kind, candidate) => { levels.push(candidate.graph.edges.find(edge => edge.id === 'voice-master')!.level); }}
			onParameterGesture={gesture => { gestures.push(gesture); return capture; }}
		/>));
		const level = dom.container.querySelectorAll('input').find(control => control.name === 'levelDb');
		assert.ok(level);
		const form = dom.one('form');
		await run({ level, levels, gestures,
			submit: async () => { await act(async () => reactProps(form).onSubmit({ preventDefault() {}, currentTarget: form })); },
		});
		assert.deepEqual(errors, [], 'valid native routing fields must reach the real commit owner');
	} finally {
		await act(async () => root.unmount());
		if (priorFormData) Object.defineProperty(globalThis, 'FormData', priorFormData);
		else Reflect.deleteProperty(globalThis, 'FormData');
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

test('saving a routing position preserves an untouched imported level below the displayed floor', async () => {
	await withInspector(false, async ({ submit, levels }) => {
		await submit();
		assert.deepEqual(levels, [], 'unchanged exact native data must not create a destructive zero-gain edit');
	});
});

test('focusing a quiet imported connection does not record zero into automation', async () => {
	await withInspector(true, async ({ level, gestures }) => {
		await act(async () => reactProps(level).onFocus({ currentTarget: level }));
		await act(async () => reactProps(level).onBlur({ currentTarget: level }));
		assert.deepEqual(gestures.map(gesture => gesture.value), [savedLevel, savedLevel]);
	});
});

test('an explicitly edited level can still choose the silent floor', async () => {
	await withInspector(false, async ({ level, submit, levels }) => {
		await act(async () => reactProps(level).onFocus({ currentTarget: level }));
		level.value = '-60';
		await act(async () => reactProps(level).onChange({ currentTarget: level }));
		await act(async () => reactProps(level).onBlur({ currentTarget: level }));
		await submit();
		assert.deepEqual(levels, [0]);
	});
});

test('cancelling an incomplete level restores the exact imported value for a later save', async () => {
	await withInspector(false, async ({ level, submit, levels }) => {
		await act(async () => reactProps(level).onFocus({ currentTarget: level }));
		level.value = '';
		await act(async () => reactProps(level).onChange({ currentTarget: level }));
		await act(async () => reactProps(level).onBlur({ currentTarget: level }));
		await submit();
		assert.deepEqual(levels, []);
	});
});
