/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EditorDialog from '../src/common/editor/ui/dialogs/EditorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

type Kind = 'rename' | 'track-rename' | 'resample';

async function dialog(type: Kind) {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: unknown[][] = [];
	let closes = 0;
	const operation = (...args: unknown[]) => { calls.push(args); };
	let generation = 1, activeId = 'original';
	const controller = { captureProjectGeneration: () => ({ projectId: activeId, generation }), actions: { project: { rename: operation }, track: { update: operation, resample: operation } } };
	const render = async (projectId = 'original', trackId = 'first', reactivate = false) => {
		if (activeId !== projectId || reactivate) generation++;
		activeId = projectId;
		await act(async () => root.render(<EditorDialog type={type}
			value={type === 'resample' ? '24000' : 'Original draft'} onValueChange={() => undefined} trackId="first"
			controller={controller} snapshot={{ project: { id: projectId, sampleRate: 48_000,
				tracks: [{ id: 'first', type: 'audio' }, { id: 'second', type: 'audio' }] }, selectedTrackId: trackId }}
			copy={ENGLISH_COPY} locale="en" run={(work: () => unknown) => work()} onClose={() => { closes++; }} />));
	};
	await render();
	return { render, calls, closes: () => closes,
		confirm: async () => {
			const text = type === 'resample' ? ENGLISH_COPY.resample : ENGLISH_COPY.saveName;
			const button = dom.container.querySelectorAll('button').find((value) => value.textContent === text);
			assert.ok(button);
			await act(async () => { reactProps(button).onClick(); await Promise.resolve(); });
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

test('MP20: project editing dialogs cannot mutate a project activated after their draft opened', async () => {
	for (const type of ['rename', 'track-rename', 'resample'] as const) {
		const view = await dialog(type);
		try {
			await view.render('replacement', 'second');
			await view.confirm();
			assert.deepEqual(view.calls, [], type);
			assert.equal(view.closes(), 1, type);
		} finally { await view.cleanup(); }
	}
});

test('MP20: track editing dialogs retain the original track when focus changes', async () => {
	for (const type of ['track-rename', 'resample'] as const) {
		const view = await dialog(type);
		try {
			await view.render('original', 'second');
			await view.confirm();
			assert.equal(view.calls[0]?.[0], 'first', type);
		} finally { await view.cleanup(); }
	}
});

test('MP20 ancillary: project editing dialogs retire when native Replace activates the same project ID', async () => {
	for (const type of ['rename', 'track-rename', 'resample'] as const) {
		const view = await dialog(type);
		try { await view.render('original', 'first', true); await view.confirm();
			assert.deepEqual(view.calls, [], type); assert.equal(view.closes(), 1, type);
		} finally { await view.cleanup(); }
	}
});
