/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import MacroFileBatchDialog from '../src/common/editor/ui/dialogs/MacroFileBatchDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { deferred } from './helpers/macro-manager-fixture.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

type Props = ComponentProps<typeof MacroFileBatchDialog>;
type Request = Parameters<NonNullable<Props['controller']['actions']['macros']['applyToFiles']>>[0];
const FOLDER = { id: 'folder', name: 'Output', displayPath: '/home/editor/Output', files: [] as string[] };
const INPUTS = [{ id: 'one', name: 'one.wav' }, { id: 'two', name: 'two.wav' }];

async function fixture() {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const calls = { folderPicks: 0, planned: [] as readonly string[][], runs: [] as Request[], releasedFolders: [] as string[], releasedInputs: [] as string[] };
	let chooseFolder: () => Promise<unknown> = () => Promise.resolve(FOLDER);
	let chooseInputs: () => Promise<unknown[]> = () => Promise.resolve(INPUTS);
	const fileService = {
		isDesktop: true,
		chooseFiles: () => chooseInputs(),
		chooseBatchSaveDirectory: () => { calls.folderPicks++; return chooseFolder(); },
		planBatchSaveOutputs: (id: string, names: readonly string[]) => {
			assert.equal(id, FOLDER.id);
			calls.planned = [...calls.planned, names.slice()];
			return { ...FOLDER, files: names.slice() };
		},
		releaseBatchSaveDirectory: (id: string) => { calls.releasedFolders.push(id); },
		releaseRead: (id: string) => { calls.releasedInputs.push(id); },
		releaseOriginalFile: () => undefined,
	};
	const root = createRoot(dom.container as unknown as HTMLElement);
	let mounted = true;
	await act(async () => { root.render(<MacroFileBatchDialog copy={ENGLISH_COPY} fileService={fileService}
		snapshot={{}} initialMacro={{ kind: 'steps', name: 'Invert', effects: [{ type: 'audacity-invert' }] }}
		onClose={() => undefined} controller={{ actions: { macros: { applyToFiles: async request => {
			calls.runs.push(request);
			return request.items.map(({ input }) => ({ name: input.name, status: 'completed' as const }));
		} } } }} />); });
	const button = (label: string) => {
		const found = dom.container.querySelectorAll('button').find(candidate => candidate.textContent.endsWith(label));
		assert.ok(found, `Missing button ${label}`);
		return found;
	};
	const click = async (label: string) => {
		await act(async () => { void reactProps(button(label)).onClick({}); });
	};
	const unmount = async () => {
		if (mounted) { mounted = false; await act(async () => { root.unmount(); }); }
	};
	return { dom, calls, button, click, unmount,
		setFolderPicker(value: () => Promise<unknown>) { chooseFolder = value; },
		setFilePicker(value: () => Promise<unknown[]>) { chooseInputs = value; },
		async cleanup() {
			await unmount();
			environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

test('batch pickers show files and the folder before Run macro, and keep selections for another run', async () => {
	const view = await fixture();
	try {
		assert.equal(reactProps(view.button('Run macro')).disabled, true);
		await view.click('Choose output folder');
		assert.match(view.dom.container.textContent, /\/home\/editor\/Output/u);
		assert.equal(view.calls.runs.length, 0);
		assert.equal(reactProps(view.button('Run macro')).disabled, true);
		await view.click('Choose audio files');
		const table = view.dom.one('table');
		assert.match(table.textContent, /one.wav/u);
		assert.match(table.textContent, /two.wav/u);
		assert.equal(reactProps(view.button('Run macro')).disabled, false);
		assert.equal(view.calls.runs.length, 0);
		await view.click('Run macro');
		assert.deepEqual(view.calls.planned, [['one-processed.wav', 'two-processed.wav']]);
		assert.equal(view.calls.runs.length, 1);
		assert.equal(view.calls.folderPicks, 1);
		assert.match(table.textContent, /Completed/u);
		assert.equal(reactProps(view.button('Run macro')).disabled, false);
		await act(async () => {
			const format = view.dom.container.querySelectorAll('select')[1]!;
			void reactProps(format).onChange({ currentTarget: { value: 'flac' } });
		});
		await view.click('Run macro');
		assert.deepEqual(view.calls.planned[1], ['one-processed.flac', 'two-processed.flac']);
		assert.equal(view.calls.folderPicks, 1);
		await view.unmount();
		assert.deepEqual(view.calls.releasedFolders, ['folder']);
		assert.deepEqual(view.calls.releasedInputs, ['one', 'two']);
	} finally { await view.cleanup(); }
});

test('cancelling either picker retains the earlier selections and never starts the macro', async () => {
	const view = await fixture();
	try {
		await view.click('Choose output folder');
		await view.click('Choose audio files');
		view.setFolderPicker(() => Promise.resolve(null));
		view.setFilePicker(() => Promise.resolve([]));
		await view.click('Choose output folder');
		await view.click('Choose audio files');
		assert.match(view.dom.container.textContent, /\/home\/editor\/Output/u);
		assert.match(view.dom.one('table').textContent, /one.wav/u);
		assert.equal(reactProps(view.button('Run macro')).disabled, false);
		assert.equal(view.calls.runs.length, 0);
	} finally { await view.cleanup(); }
});

test('an output folder selected after the dialog closes is released without running', async () => {
	const view = await fixture();
	const pending = deferred<unknown>();
	try {
		view.setFolderPicker(() => pending.promise);
		await view.click('Choose output folder');
		await view.unmount();
		await act(async () => { pending.resolve(FOLDER); await pending.promise; });
		assert.deepEqual(view.calls.releasedFolders, ['folder']);
		assert.equal(view.calls.runs.length, 0);
	} finally { pending.resolve(null); await view.cleanup(); }
});
