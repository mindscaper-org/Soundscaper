/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface NativePanel { readonly defaultPath: string; readonly filters: readonly { readonly name: string; readonly extensions: readonly string[] }[] }

function nativeSaveFixture() {
	const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
	const panels: NativePanel[] = [];
	registerFileCapabilityIpc({
		channels: { chooseFiles: 'open', releaseRead: 'release', chooseSaveTarget: 'save', releaseSaveTarget: 'release-save',
			beginWrite: 'begin', writeChunk: 'chunk', patchFinalPrefix: 'prefix', finishWrite: 'finish', abortWrite: 'abort' },
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
			showSaveDialog: async (_window: unknown, options: NativePanel) => {
				panels.push(options); return { canceled: true, filePath: '' };
			} },
		handle: (channel: string, listener: (event: unknown, value: unknown) => unknown) => { handlers.set(channel, listener); },
		opaqueId: (value: unknown) => String(value), ownerFor: () => 'owner', pendingOpenProjects: new Map(),
		readCapabilities: {}, saves: {}, saveTargets: { registerPath: () => null }, windowFor: () => null,
	});
	const handler = handlers.get('save'); assert.ok(handler);
	const fileService = createAudioEditorFileService({ bridge: {
		chooseSaveTarget: async (request: unknown) => await handler({}, request),
	} });
	return { fileService, panels };
}

function assertOffered(panel: NativePanel | undefined, extension: string) {
	assert.ok(panel, 'the production export must reach the native save dialog');
	assert.ok(panel.defaultPath.endsWith(`.${extension}`));
	assert.ok(panel.filters.some(filter => filter.extensions.includes(extension)),
		`the native save panel must offer ${extension}, received ${JSON.stringify(panel.filters)}`);
}

test('MI26: caption export offers its actual sidecar type in the native save panel', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const fixture = nativeSaveFixture();
	const seed = createFramescaperProject(PROFILE, { id: 'caption-native-save' });
	const imported = importFramescaperCaptionSidecar({ project: seed, format: 'srt',
		text: '1\n00:00:00,000 --> 00:00:01,000\nHello\n', trackId: 'captions',
		sequenceId: seed.primarySequenceId, trackName: 'Captions', language: 'en' });
	const project = applyFramescaperProjectCommand(PROFILE, seed, imported.command);
	try {
		await act(async () => root.render(<FramescaperFinishingDialog surface="captions" project={project}
			controller={{ actions: { edit: { commit: () => undefined } } }} editingBlocked={false} readOnly={false}
			fileService={fixture.fileService} run={operation => operation()} onClose={() => undefined} />));
		for (const [format, extension] of [['srt', 'srt'], ['webvtt', 'vtt'], ['imsc1.1', 'ttml']] as const) {
			await act(async () => { reactProps(dom.one('select')).onChange({ currentTarget: { value: format } }); });
			const button = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === 'Export selected track');
			assert.ok(button);
			await act(async () => { reactProps(button).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
			assertOffered(fixture.panels.at(-1), extension);
		}
	} finally { await act(async () => root.unmount()); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; }
});

test('MI26: Export Labels podcast JSON offers JSON in the native save panel', async context => {
	const fixture = nativeSaveFixture();
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), fileService: fixture.fileService,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'podcast-json-native-save' }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	controller.actions.labels.add(null, { title: 'First chapter', startFrame: 0, endFrame: 48_000 });
	await controller.actions.labels.export({ format: 'json' });
	assertOffered(fixture.panels[0], 'json');
});
