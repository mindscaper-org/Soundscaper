/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import AudioEditorMacroManagerDialog from '../src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx';
import { useWorkspaceDockPresentation } from '../src/common/editor/ui/workspace/useWorkspaceDockPresentation.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

test('the retired macro file batch has no controller, dialog or stylesheet', async () => {
	const source = new URL('../src/common/editor/', import.meta.url);
	for (const file of ['controller/effects/macro-file-batch-service.ts', 'ui/dialogs/MacroFileBatchDialog.tsx',
		'ui/dialogs/MacroFileBatchDialog.css']) {
		await assert.rejects(access(new URL(file, source)), { code: 'ENOENT' });
	}
});

test('Framescaper excludes a restored Macros palette from the visible dock', async () => {
	const ui = mountControllerDataDom();
	const panels = {
		'macros-palette': { visible: true, dock: 'right', order: 1, size: 320 },
		'clip-properties': { visible: true, dock: 'right', order: 2, size: 320 },
	} as const;
	function Dock({ productId }: Readonly<{ productId: string }>) {
		const { panels: visible } = useWorkspaceDockPresentation('right', panels, productId, true, true, true,
			null, null, true, true, ENGLISH_COPY);
		return React.createElement('output', null, visible.map(([id]) => id).join(','));
	}
	try {
		await ui.render(React.createElement(Dock, { productId: 'framescaper' }));
		assert.equal(ui.dom.one('output').textContent, 'clip-properties');
		await ui.render(React.createElement(Dock, { productId: 'soundscaper' }));
		assert.equal(ui.dom.one('output').textContent, 'macros-palette,clip-properties');
	} finally { await ui.dispose(); }
});

test('the shared Macro Manager keeps its saved definition on both hosts', async context => {
	const { controller } = await controllerSession(context, {
		engineFactory: () => { throw new Error('Displaying a saved macro must not render audio.'); },
	});
	const initialProject = structuredClone(controller.project);
	const initialHistory = structuredClone(controller.getSnapshot().history);
	const ui = mountControllerDataDom();
	const draft = controller.actions.macros.library.list().find(macro => macro.name === 'Fade ends');
	assert.ok(draft);
	try {
		for (const bridge of [{}, null]) {
			const fileService = createAudioEditorFileService({ bridge });
			await ui.render(React.createElement(AudioEditorMacroManagerDialog, {
				isOpen: true, productId: 'soundscaper', controller, snapshot: controller.getSnapshot(),
				copy: ENGLISH_COPY, locale: 'en', fileService, draft,
				onDraftChange: () => assert.fail('Displaying a saved macro must not edit its draft.'),
				onClose: () => assert.fail('Displaying a saved macro must not close the manager.'),
			}));
			assert.equal(ui.dom.container.querySelectorAll('[data-macro-manager]').length, 1);
			const buttons = ui.dom.container.querySelectorAll('button');
			assert.equal(buttons.some(button => button.textContent === ENGLISH_COPY.macroApplyToFiles), false);
			assert.deepEqual(controller.actions.macros.library.list().find(macro => macro.id === draft.id), draft);
		}
		assert.deepEqual(controller.project, initialProject);
		assert.deepEqual(controller.getSnapshot().history, initialHistory);
	} finally { await ui.dispose(); }
});
