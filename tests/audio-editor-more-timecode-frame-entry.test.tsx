/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
for (const [format, value, expected] of [
	['film frames (24fps)', '24', 48_000], ['PAL frames (25 fps)', '25', 48_000],
	['CDDA frames (75 fps)', '75', 48_000], ['NTSC frames (29.97 fps)', '30', 48_048],
	['hh:mm:ss + frames (24fps)', '00:00:01:12', 72_000],
] as const) test(`MP61: Generate Tone interprets ${value} in ${format}`, async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let frames = 0;
	const controller = { project: { id: 'tone-project', sampleRate: 48_000, tracks: [], clips: [] }, actions: { generators: {
		generate(type: string, options: Readonly<Record<string, unknown>>) { frames = generateAudioEditorSignal(type, { ...options, sampleRate: 48_000 }).frameCount; },
	} } };
	try {
		await act(async () => root.render(<GeneratorDialog type="tone" controller={controller} snapshot={{}} copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => operation()} onClose={() => undefined} />));
		const duration = dom.one('[data-generator-field="durationSeconds"]');
		const button = duration.querySelector('.timecode__format-button'); assert.ok(button);
		await act(async () => reactProps(button).onClick({ detail: 1 }));
		const groupName = format.includes('CDDA') ? 'CD frames' : 'Video frames';
		const group = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent.includes(groupName)); assert.ok(group);
		await act(async () => reactProps(group).onClick({ stopPropagation() {}, preventDefault() {} }));
		const choice = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.querySelector('.context-menu-item-label')?.textContent === format); assert.ok(choice);
		await act(async () => reactProps(choice).onClick({}));
		await act(async () => reactProps(button).onClick({ detail: 1 }));
		const enter = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'Enter value…'); assert.ok(enter);
		await act(async () => reactProps(enter).onClick({}));
		const input = dom.one('.timecode__free-text');
		await act(async () => reactProps(input).onChange({ currentTarget: { value } }));
		await act(async () => reactProps(input).onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }));
		const generate = dom.container.querySelectorAll('button').find(item => item.textContent === ENGLISH_COPY.generate); assert.ok(generate);
		await act(async () => reactProps(generate).onClick());
		assert.equal(frames, expected);
	} finally {
		await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
