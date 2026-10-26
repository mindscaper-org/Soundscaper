/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';
import { validateSaveChoice } from '../desktop/validation.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createMacroScriptLibraryService } from '../src/common/editor/controller/effects/macro-script-library-service.ts';
import { createMacroScriptLibrary } from '../src/common/editor/macro-script-library.ts';
import { MACRO_SCRIPT_FILE_EXTENSION } from '../src/common/editor/macro-script-envelope.ts';
import AudioEditorMacroManagerDialog from '../src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface SavePanel {
	readonly defaultPath: string;
	readonly filters: readonly { readonly name: string; readonly extensions: readonly string[] }[];
}

test('Export program offers the macro program file type in the actual native save dialog', async () => {
	const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
	const panels: SavePanel[] = [];
	registerFileCapabilityIpc({
		channels: { chooseFiles: 'open', releaseRead: 'release', chooseSaveTarget: 'save', releaseSaveTarget: 'release-save',
			beginWrite: 'begin', writeChunk: 'chunk', patchFinalPrefix: 'prefix', finishWrite: 'finish', abortWrite: 'abort' },
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
			showSaveDialog: async (_window: unknown, options: SavePanel) => {
				panels.push(options); return { canceled: true, filePath: '' };
			} },
		handle: (channel: string, listener: (event: unknown, value: unknown) => unknown) => { handlers.set(channel, listener); },
		opaqueId: (value: unknown) => String(value), ownerFor: () => 'owner', pendingOpenProjects: new Map(),
		readCapabilities: {}, saves: {}, saveTargets: { registerPath: () => null }, windowFor: () => null,
	});
	const save = handlers.get('save'); assert.ok(save);
	const fileService = createAudioEditorFileService({ bridge: { chooseSaveTarget: async (request: unknown) => await save({}, request) } });
	const state = { macroScripts: createMacroScriptLibrary() };
	const scripts = createMacroScriptLibraryService({ state, createId: () => 'program', persistSetting: async () => undefined,
		publishDocumentSnapshot: () => undefined, handleError: cause => { throw cause; } });
	scripts.save({ name: 'Review program', source: "sound.log.info('review');" });
	const project = createSoundscaperProject({ id: 'program-native-save' });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AudioEditorMacroManagerDialog isOpen productId="soundscaper"
			controller={{ project, actions: { macros: { scripts, library: {} } } }}
			snapshot={{ ready: true, project, macros: { library: [], scripts: scripts.list() } }}
			copy={ENGLISH_COPY} locale="en" fileService={fileService} draft={null}
			onDraftChange={() => undefined} onClose={() => undefined} />));
		await act(async () => { reactProps(dom.one('[data-macro-script-id]')).onClick({}); });
		const button = dom.container.querySelectorAll('button').find(candidate => candidate.getAttribute('aria-label') === 'Export program');
		assert.ok(button);
		await act(async () => { reactProps(button).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.equal(panels.length, 1);
		assert.equal(panels[0]?.defaultPath.split('/').at(-1), `Review-program${MACRO_SCRIPT_FILE_EXTENSION}`);
		assert.deepEqual(panels[0]?.filters[0]?.extensions, [MACRO_SCRIPT_FILE_EXTENSION.slice(1)],
			'the native save dialog must offer the program being exported');
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
	}
});

test('Audacity text macro exports retain their native text filter and default suffix', () => {
	assert.deepEqual(validateSaveChoice({ purpose: 'macro', suggestedName: 'Fade.txt' }).filters,
		[{ name: 'Audacity macro', extensions: ['txt'] }]);
	assert.equal(validateSaveChoice({ purpose: 'macro', suggestedName: 'Fade' }).suggestedName, 'Fade.txt');
	assert.deepEqual(validateSaveChoice({ purpose: 'macro', suggestedName: 'Review.SOUNDSCAPEMACRO' }).filters[0]?.extensions,
		[MACRO_SCRIPT_FILE_EXTENSION.slice(1)]);
});
