/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { runMacroFileBatch, type MacroFileBatchDefinition } from '../src/common/editor/controller/effects/macro-file-batch-service.ts';
import AudioEditorMacroManagerDialog from '../src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { reactProps } from './helpers/react-test-dom.ts';

// The JSX owner's optional callback defaults to undefined; preserve its other inferred props.
type MacroManagerProps = Omit<React.ComponentProps<typeof AudioEditorMacroManagerDialog>, 'onApplyToFiles'> & {
	readonly onApplyToFiles: (macro: MacroFileBatchDefinition) => void;
};
const MacroManager = AudioEditorMacroManagerDialog as unknown as React.ComponentType<MacroManagerProps>;

test('batch macros use isolated sequential sessions, continue after failure and dispose every session', async () => {
	const events: string[] = [];
	const result = await runMacroFileBatch({
		createSession: async (input: { name: string }) => {
			events.push(`open:${input.name}`);
			return {
				run: async () => { events.push(`run:${input.name}`); if (input.name === 'broken.wav') throw new Error('Bad input'); },
				export: async () => { events.push(`export:${input.name}`); },
				dispose: async () => { events.push(`dispose:${input.name}`); },
			};
		},
	}, { macro: { kind: 'steps', name: 'Normalize', effects: [{ type: 'audacity-normalize' }] },
		items: ['one.wav', 'broken.wav', 'three.wav'].map(name => ({ input: { name }, target: { id: name, name } })),
		format: 'wav', signal: new AbortController().signal,
	});
	assert.deepEqual(events, ['open:one.wav', 'run:one.wav', 'export:one.wav', 'dispose:one.wav',
		'open:broken.wav', 'run:broken.wav', 'dispose:broken.wav', 'open:three.wav', 'run:three.wav', 'export:three.wav', 'dispose:three.wav']);
	assert.deepEqual(result.map(row => row.status), ['completed', 'failed', 'completed']);
	assert.equal(result[1]?.message, 'Bad input');
});

test('batch cancellation stops before export and does not open subsequent files', async () => {
	const cancellation = new AbortController(), events: string[] = [];
	const result = await runMacroFileBatch({ createSession: async () => ({
		run: async () => { cancellation.abort(new DOMException('Cancelled', 'AbortError')); },
		export: async () => { events.push('export'); }, dispose: async () => { events.push('dispose'); },
	}) }, { macro: { kind: 'script', name: 'Test', source: 'await sound.select.all();' }, format: 'wav', signal: cancellation.signal,
		items: ['one', 'two'].map(name => ({ input: { name }, target: { id: name, name } })),
	});
	assert.deepEqual(events, ['dispose']);
	assert.deepEqual(result.map(row => row.status), ['cancelled', 'skipped']);
});

test('the real web macro manager with a usable batch callback does not offer Apply to files', async context => {
	const { controller } = await controllerSession(context, {
		engineFactory: () => { throw new Error('Macro host admission must not render audio.'); },
	});
	const initialProject = structuredClone(controller.project);
	const initialHistory = structuredClone(controller.getSnapshot().history);
	const palette = mountControllerDataDom();
	const draft = controller.actions.macros.library.list().find(macro => macro.name === 'Fade ends');
	assert.ok(draft, 'the real controller supplies its initialized macro library');
	const applied: MacroFileBatchDefinition[] = [];
	const onApplyToFiles = (macro: MacroFileBatchDefinition) => { applied.push(macro); };
	const desktop = createAudioEditorFileService({ bridge: {} });
	const web = createAudioEditorFileService({ bridge: null });
	const render = (fileService: typeof web) => palette.render(React.createElement(MacroManager, {
		isOpen: true, productId: 'soundscaper', controller, snapshot: controller.getSnapshot(),
		copy: ENGLISH_COPY, locale: 'en', fileService, draft,
		onDraftChange: (next: unknown) => { assert.deepEqual(next, draft); },
		onClose: () => { assert.fail('The admission check does not close the manager.'); },
		onApplyToFiles,
	}));
	const batchButtons = () => palette.dom.container.querySelectorAll('button')
		.filter(button => button.textContent === ENGLISH_COPY.macroApplyToFiles);
	try {
		await render(desktop);
		assert.equal(desktop.isDesktop, true);
		const button = batchButtons()[0]; assert.ok(button);
		assert.equal(button.hasAttribute('disabled'), false);
		await act(async () => { reactProps(button).onClick(); });
		assert.deepEqual(applied, [{ kind: 'steps', name: draft.name, effects: draft.effects }],
			'the same usable callback can receive an actual initialized macro');
		await render(web);
		assert.equal(web.isDesktop, false);
		assert.equal(palette.dom.container.querySelectorAll('[data-macros-palette]').length, 1,
			'the actual manager is mounted rather than absent along with its actions');
		assert.equal(batchButtons().length, 0);
		assert.equal(applied.length, 1);
		assert.deepEqual(controller.project, initialProject);
		assert.deepEqual(controller.getSnapshot().history, initialHistory);
	} finally { await palette.dispose(); }
});
