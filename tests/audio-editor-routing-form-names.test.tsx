/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import SoundscaperRoutingGraphInspector from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphInspector.tsx';
import { RoutingNameInput } from '../src/common/editor/ui/workspace/RoutingInspectorForm.tsx';
import { addSoundscaperRoutingItem } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY as copy } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const kind of ['cue', 'output', 'vca'] as const) {
	for (const name of ['Opening room tone', 'Opening\nRoom tone', 'Opening\r\nRoom tone']) {
		test(`${kind} retains untouched native name ${JSON.stringify(name)} when another field changes`, async () => {
			const result = await save(kind, name);
			assert.equal(result.name, name);
			assert.equal(result.control, /[\r\n]/u.test(name) ? 'TEXTAREA' : 'INPUT');
		});
	}
	test(`${kind} can edit a carried multiline name without trimming its whitespace`, async () => {
		const result = await save(kind, 'Opening\r\nRoom tone', ' Opening\nRoom tone encore ');
		assert.equal(result.name, ' Opening\nRoom tone encore ');
	});
}

test('multiline form completion leaves composing, modified and Shift+Enter keys to their owner', async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as HTMLElement);
	try {
		await act(async () => root.render(<RoutingNameInput value={'Opening\nRoom tone'} disabled={false} />));
		const input = dom.one('textarea');
		let submits = 0;
		const scenarios = [
			{ nativeEvent: { isComposing: true, keyCode: 13 } },
			{ nativeEvent: { isComposing: false, keyCode: 229 } },
			{ ctrlKey: true }, { metaKey: true }, { altKey: true },
			{ shiftKey: true }, { defaultPrevented: true }, { key: 'Escape' },
		];
		for (const scenario of scenarios) {
			let prevented = false;
			await act(async () => reactProps(input).onKeyDown({ key: 'Enter', defaultPrevented: false,
				nativeEvent: { isComposing: false, keyCode: 13 }, ctrlKey: false, metaKey: false, altKey: false,
				shiftKey: false, currentTarget: { form: { requestSubmit() { submits += 1; } } },
				preventDefault() { prevented = true; }, stopPropagation() {}, ...scenario }));
			assert.equal(submits, 0, JSON.stringify(scenario));
			assert.equal(prevented, false);
		}
		await act(async () => reactProps(input).onKeyDown({ key: 'Enter', defaultPrevented: false,
			nativeEvent: { isComposing: false, keyCode: 13 }, ctrlKey: false, metaKey: false, altKey: false,
			shiftKey: false, currentTarget: { form: { requestSubmit() { submits += 1; } } },
			preventDefault() {}, stopPropagation() {} }));
		assert.equal(submits, 1, 'plain Enter still submits exactly once');
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

async function save(kind: 'cue' | 'output' | 'vca', name: string, edited?: string) {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as HTMLElement);
	const base = createSoundscaperProject({ id: 'routing-form-name' });
	const added = addSoundscaperRoutingItem(base, base.mixer, kind);
	const collection = kind === 'cue' ? 'cues' : kind === 'output' ? 'outputs' : 'vcas';
	const graph = { ...added.graph, [collection]: added.graph[collection].map(item => ({ ...item, ...(item.id === added.selection.id ? { name } : {}) })) };
	const project = createSoundscaperProject({ ...base, mixer: graph });
	const priorFormData = globalThis.FormData;
	class NativeFormData extends FormData {
		constructor(form?: HTMLFormElement) {
			super();
			for (const control of (form as unknown as ReactTestElement).querySelectorAll('input,select,textarea')) {
				if (control.type !== 'checkbox' || control.checked) this.append(control.name, control.value);
			}
		}
	}
	globalThis.FormData = NativeFormData;
	let delivered: string | null = null;
	try {
		await act(async () => root.render(<SoundscaperRoutingGraphInspector project={project} graph={project.mixer}
			selection={added.selection} copy={copy} disabled={false} confirmingDelete={false}
			onConfirmingDelete={() => undefined} onError={cause => { throw cause; }} onCandidate={(_kind, candidate) => {
				delivered = candidate.graph[collection].find(item => item.id === added.selection.id)!.name;
			}} />));
		const form = dom.one('form');
		const controls = form.querySelectorAll('input,textarea');
		const title = controls.find(control => control.name === 'name');
		assert.ok(title);
		// The small mounted DOM does not implement native text sanitization.
		// Chromium's paired archive test proves the real input strips LF/CR,
		// whereas textarea values normalize CRLF to LF without losing lines.
		title.value = title.tagName === 'INPUT' ? title.value.replace(/[\r\n]/gu, '') : title.value.replace(/\r\n?/gu, '\n');
		if (edited !== undefined) title.value = edited;
		const other = controls.find(control => control.name === (kind === 'vca' ? 'gain' : 'channelCount'));
		assert.ok(other); other.value = kind === 'vca' ? '.75' : '1';
		Object.defineProperty(form, 'reportValidity', { value: () => true });
		await act(async () => reactProps(form).onSubmit({ currentTarget: form, preventDefault() {} }));
		return { name: delivered, control: title.tagName };
	} finally {
		await act(async () => root.unmount());
		globalThis.FormData = priorFormData;
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}
