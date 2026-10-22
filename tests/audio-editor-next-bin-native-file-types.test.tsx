/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';
import { acceptsFile } from '../desktop/validation.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import ProjectBinPanel from '../src/common/editor/ui/workspace/ProjectBinPanel.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface OpenPanel {
	readonly filters: readonly { readonly name: string; readonly extensions: readonly string[] }[];
}

test('Project Bin native Import offers source media without CUE sheets or label files', async () => {
	const panels: OpenPanel[] = [];
	const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
	registerFileCapabilityIpc({
		channels: { chooseFiles: 'open', releaseRead: 'release', chooseSaveTarget: 'save', releaseSaveTarget: 'release-save',
			beginWrite: 'begin', writeChunk: 'chunk', patchFinalPrefix: 'prefix', finishWrite: 'finish', abortWrite: 'abort' },
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: { showOpenDialog: async (_window: unknown, options: OpenPanel) => {
			panels.push(options); return { canceled: true, filePaths: [] };
		}, showSaveDialog: async () => ({ canceled: true }) },
		handle: (channel: string, listener: (event: unknown, value: unknown) => unknown) => { handlers.set(channel, listener); },
		opaqueId: (value: unknown) => String(value), ownerFor: () => 'owner', pendingOpenProjects: new Map(),
		readCapabilities: {}, saves: {}, saveTargets: { registerPath: () => null }, windowFor: () => null,
	});
	const open = handlers.get('open'); assert.ok(open);
	let purpose = '';
	const fileService = createAudioEditorFileService({ bridge: { chooseFiles: async (request: { purpose: string }) => {
		purpose = request.purpose; return await open({}, request);
	} } });
	const project = { id: 'bin', revision: 0, tracks: [], clips: [], sources: [], projectBin: { clips: [] } };
	const controller = { getSnapshot: () => ({ project }), actions: { projectBin: {}, project: {
		importFiles: () => { throw new Error('A cancelled picker cannot import.'); },
	} } };
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	let operation: Promise<unknown> = Promise.resolve();
	try {
		await act(async () => root.render(<ProjectBinPanel controller={controller} snapshot={{ project, missingSourceIds: [] }}
			copy={ENGLISH_COPY} locale="en" fileService={fileService} blocked={false}
			run={(callback: () => unknown) => { operation = Promise.resolve(callback()); return operation; }} />));
		const importButton = dom.container.querySelectorAll('button').find(button => button.textContent === ENGLISH_COPY.projectBinImport);
		assert.ok(importButton);
		await act(async () => { reactProps(importButton).onClick(); await operation; });
		assert.equal(panels.length, 1);
		const offered = panels[0]!.filters.flatMap(filter => filter.extensions);
		for (const extension of ['wav', 'aifc', 'wave', 'bw64', 'flac', 'wv', 'mp4', 'm4v', 'webm']) {
			assert.ok(offered.includes(extension), `Project Bin must still offer ${extension}`);
			assert.equal(acceptsFile(purpose, `recording.${extension}`), true);
		}
		for (const extension of ['cue', 'txt', 'srt', 'vtt']) {
			assert.equal(offered.includes(extension), false, `Project Bin cannot decode ${extension} as a media source`);
			assert.equal(acceptsFile(purpose, `labels.${extension}`), false);
			assert.equal(acceptsFile('media', `labels.${extension}`), true, 'File Import retains its existing label/CUE route');
		}
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
	}
});
