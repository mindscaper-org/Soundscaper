/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { IPC } from '../desktop/constants.js';
import { createFramescaperDesktopProjectLibraryPaths } from '../desktop/framescaper-project-library-contract.ts';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { registerDesktopLinkedVideoLocatorIpc } from '../desktop/linked-video-locator-ipc.js';
import { FileDesktopLinkedVideoLocatorRegistry } from '../desktop/linked-video-locator-registry.ts';
import { DesktopLinkedVideoLocatorStore } from '../desktop/linked-video-locator-store.ts';
import { createProtocolHandler } from '../desktop/protocol.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { ProjectDuplicationIndeterminateError } from '../src/common/editor/storage/project-duplication.ts';
import { editorProjectEditSessionKey } from '../src/common/editor/ui/project-edit-session-key.ts';
import { importLinkedProjectBinChoice } from '../src/common/editor/ui/workspace/linked-project-bin-import.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { startFramescaperDesktopProjectSession } from './helpers/framescaper-desktop-project-session.ts';
import { openFramescaperImageFixtureLibrary } from './helpers/framescaper-portable-timeline-image.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';

test('Framescaper desktop Duplicate keeps a project-local linked WAV after deleting the original project', async context => {
	const previousAudioContext = globalThis.AudioContext;
	globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
	context.after(() => { globalThis.AudioContext = previousAudioContext; });
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-linked-project-duplicate-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const archive = await writeProjectArchive(directory);
	const name = 'field-recording.wav';
	const pcm = Float32Array.from({ length: 4_096 }, (_, index) => (index % 97 - 48) / 256);
	const encoded = encodeWav([pcm], { sampleRate: 48_000, float: true, dither: 'none' });
	assert.ok(encoded instanceof Uint8Array);
	const input = join(directory, name);
	await writeFile(input, encoded);
	const { fileService, close: closeLocators } = linkedFileService(directory, input);
	const indexedDB = createInstrumentedIndexedDB();
	const openEnvironment = () => createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB, preferOpfs: false, storageManager: { estimate: async () => ({ usage: 0, quota: 4 * 1024 ** 3 }) },
		linkedOriginalPort: fileService.linkedOriginalPort,
		linkedVideoOriginalPort: fileService.linkedVideoOriginalPort,
	} });
	const presentation = { locale: 'en', fileService };
	let copyId: string;
	let originalLocator: { locatorId: string; locatorRevision: string; bindingToken: string };
	try {
		const desktop = await startFramescaperDesktopProjectSession(directory, { openEnvironment, presentation });
		const { controller, environment } = desktop;
		try {
			await controller.actions.project.openScapeFile(archive, () => assert.fail('Expected a new working copy.'));
			const originId = controller.project?.id;
			assert.equal(originId, 'linked-archive');
			await importLinkedProjectBinChoice({
				getProjectSessionKey: () => editorProjectEditSessionKey(controller, controller.project?.id),
				choose: fileService.chooseLinkedAudioOriginal,
				release: fileService.releaseLinkedAudioOriginal,
				importFile: (file, options) => controller.actions.project.importFiles([file], options),
			}, 'audio');
			const [source] = controller.project?.sources ?? [];
			assert.ok(source && source.kind === 'audio', controller.getSnapshot().status?.message);
			const origin = await environment.store.getLinkedOriginalBinding(originId, source.id);
			assert.ok(origin && origin.kind === 'audio');
			originalLocator = origin;
			assert.equal((await environment.store.getSourceMetadata(source.storageKey))?.storage, 'linked-audio-original-v1');
			const before = await environment.store.resolveLinkedAudioOriginal(originId, source);
			assert.ok(before);
			assert.deepEqual(new Uint8Array(await before.blob.arrayBuffer()), encoded);
			await controller.actions.project.duplicate(undefined);
			const copy = controller.project;
			assert.ok(copy && copy.id !== originId);
			copyId = copy.id;
			assert.equal(copy.title, 'Field dialogue copy');
			const database = new DatabaseSync(createFramescaperDesktopProjectLibraryPaths(directory).databasePath, { readOnly: true });
			try {
				assert.ok(database.prepare('SELECT project_id FROM projects WHERE project_id = ?').get(copyId));
			} finally { database.close(); }
			assert.equal((await environment.store.getSourceMetadata(source.storageKey))?.storage, 'linked-audio-original-v1');
			await controller.actions.project.openById(originId);
			await controller.actions.project.remove(originId);
			assert.equal(await environment.store.getLinkedOriginalBinding(originId, source.id), null);
		} finally { await desktop.close(); }
		let failedDestination: string | null = null;
		let failBeforePublication = true;
		const transferFailure = new Error('The duplicate reply was interrupted.');
		const restarted = await startFramescaperDesktopProjectSession(directory, { openEnvironment, presentation,
			duplicateProject: async (request, publish) => {
				assert.ok(request && typeof request === 'object' && 'copyProjectId' in request && typeof request.copyProjectId === 'string');
				failedDestination = request.copyProjectId;
				if (!failBeforePublication) await publish();
				throw transferFailure;
			},
		});
		try {
			await restarted.controller.actions.project.openById(copyId);
			const [source] = restarted.controller.project?.sources ?? [];
			assert.ok(source && source.kind === 'audio');
			const after = await restarted.environment.store.resolveLinkedAudioOriginal(copyId, source);
			assert.ok(after, 'SQLite reopened the copied project without its linked WAV after deleting the original project.');
			assert.deepEqual(new Uint8Array(await after.blob.arrayBuffer()), encoded);
			assert.notEqual(after.binding.bindingToken, originalLocator.bindingToken);
			assert.equal(after.binding.locatorId, originalLocator.locatorId);
			assert.equal(after.binding.locatorRevision, originalLocator.locatorRevision);
			const chunk = await restarted.environment.store.readSourceChunk(source.storageKey, 0);
			assert.deepEqual(chunk.channels[0], pcm);

			await assert.rejects(restarted.controller.actions.project.duplicate(undefined), error => error === transferFailure);
			assert.ok(failedDestination);
			assert.equal(await restarted.environment.store.getLinkedOriginalBinding(failedDestination, source.id), null);
			assert.equal(await restarted.environment.controllerStore.loadProject(failedDestination), null);

			failBeforePublication = false;
			await assert.rejects(restarted.controller.actions.project.duplicate(undefined), ProjectDuplicationIndeterminateError);
			assert.ok(await restarted.environment.controllerStore.loadProject(failedDestination));
			const uncertainCopy = await restarted.environment.store.resolveLinkedAudioOriginal(failedDestination, source);
			assert.ok(uncertainCopy);
			assert.deepEqual(new Uint8Array(await uncertainCopy.blob.arrayBuffer()), encoded);
		} finally { await restarted.close(); }
	} finally { await closeLocators(); }
});

test('Framescaper Link WAV reopens the exact native path when its display name is trimmed', async context => {
	const previousAudioContext = globalThis.AudioContext;
	globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
	context.after(() => { globalThis.AudioContext = previousAudioContext; });
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-linked-audio-display-name-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const archive = await writeProjectArchive(directory);
	const selected = join(directory, '  recording.wav');
	const samples = Float32Array.from({ length: 4_096 }, (_, index) => (index % 97 - 48) / 256);
	const encoded = encodeWav([samples], { sampleRate: 48_000, float: true, dither: 'none' });
	const sibling = encodeWav([new Float32Array(samples.length).fill(.5)], { sampleRate: 48_000, float: true, dither: 'none' });
	assert.ok(encoded instanceof Uint8Array && sibling instanceof Uint8Array);
	await writeFile(selected, encoded);
	await writeFile(join(directory, 'recording.wav'), sibling);
	const indexedDB = createInstrumentedIndexedDB();
	const initial = await open();
	let locatorId: string;
	try {
		const { controller, fileService } = initial;
		await controller.actions.project.openScapeFile(archive, () => assert.fail('Expected a new project.'));
		await importLinkedProjectBinChoice({
			getProjectSessionKey: () => editorProjectEditSessionKey(controller, controller.project?.id),
			choose: fileService.chooseLinkedAudioOriginal,
			release: fileService.releaseLinkedAudioOriginal,
			importFile: (file, options) => controller.actions.project.importFiles([file], options),
		}, 'audio');
		const [source] = controller.project?.sources ?? [];
		assert.ok(source?.kind === 'audio');
		const locator = await initial.environment.store.getLinkedOriginalBinding('linked-archive', source.id);
		assert.ok(locator?.kind === 'audio');
		locatorId = locator.locatorId;
	} finally { await initial.close(); }

	const registry = new FileDesktopLinkedVideoLocatorRegistry(join(directory, 'linked-originals.json'));
	const [record] = await registry.read();
	assert.ok(record);
	assert.equal(record.name, 'recording.wav');
	assert.equal(record.path, selected);
	assert.equal(record.locatorId, locatorId);
	const identity = await stat(selected);
	assert.deepEqual([record.identity.dev, record.identity.ino], [identity.dev, identity.ino]);
	const restarted = await open();
	try {
		await restarted.controller.actions.project.openById('linked-archive');
		const [source] = restarted.controller.project?.sources ?? [];
		assert.ok(source?.kind === 'audio');
		const resolved = await restarted.environment.store.resolveLinkedAudioOriginal('linked-archive', source);
		assert.ok(resolved);
		assert.equal(resolved.binding.locatorId, locatorId);
		assert.deepEqual(new Uint8Array(await resolved.blob.arrayBuffer()), encoded);
		const chunk = await restarted.environment.store.readSourceChunk(source.storageKey, 0);
		assert.deepEqual(chunk.channels[0], samples);
	} finally { await restarted.close(); }

	async function open() {
		const native = linkedFileService(directory, selected);
		try {
			const { fileService } = native;
			const session = await startFramescaperDesktopProjectSession(directory, {
				openEnvironment: () => createFramescaperEditorProjectEnvironment({ storeOptions: {
					indexedDB, preferOpfs: false, storageManager: { estimate: async () => ({ usage: 0, quota: 4 * 1024 ** 3 }) },
					linkedOriginalPort: fileService.linkedOriginalPort,
					linkedVideoOriginalPort: fileService.linkedVideoOriginalPort,
				} }), presentation: { locale: 'en', fileService },
			});
			return { ...session, fileService, async close() { try { await session.close(); } finally { await native.close(); } } };
		} catch (error) { await native.close(); throw error; }
	}
});

test('the desktop linked-video chooser reads a selected WebM behind a trimmed display name', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-linked-video-display-name-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const path = join(directory, '  interview.webm');
	const bytes = await readFile(new URL('./electron/local-assistance-models/fixtures/editor-workflows.webm', import.meta.url));
	await writeFile(path, bytes);
	await writeFile(join(directory, 'interview.webm'), new Uint8Array([0]));
	const { fileService, close } = linkedFileService(directory, path);
	try {
		const choice = await fileService.chooseLinkedVideoOriginal();
		assert.ok(choice);
		assert.equal(choice.name, 'interview.webm');
		assert.deepEqual(Buffer.from(await choice.file.arrayBuffer()), bytes);
	} finally { await close(); }
});

test('Framescaper desktop Clear preserves a saved portable project and its linked physical WAV', async context => {
	const previousAudioContext = globalThis.AudioContext;
	globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
	context.after(() => { globalThis.AudioContext = previousAudioContext; });
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-clear-linked-original-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const archive = await writeProjectArchive(directory);
	const samples = Float32Array.from({ length: 4096 }, (_, index) => (index % 97 - 48) / 256);
	const encoded = encodeWav([samples], { sampleRate: 48_000, float: true, dither: 'none' });
	assert.ok(encoded instanceof Uint8Array);
	const input = join(directory, 'field.wav');
	await writeFile(input, encoded);
	const indexedDB = createInstrumentedIndexedDB();
	const native = linkedFileService(directory, input);
	const { fileService } = native;
	const open = () => startFramescaperDesktopProjectSession(directory, {
		openEnvironment: () => createFramescaperEditorProjectEnvironment({ storeOptions: {
			indexedDB, preferOpfs: false, storageManager: { estimate: async () => ({ usage: 0, quota: 4 * 1024 ** 3 }) },
			linkedOriginalPort: fileService.linkedOriginalPort, linkedVideoOriginalPort: fileService.linkedVideoOriginalPort,
		} }), presentation: { locale: 'en', fileService },
	});
	try {
		const projectId = 'linked-archive';
		const initial = await open();
		let locatorId: string;
		try {
			const { controller, environment } = initial;
			await controller.actions.project.openScapeFile(archive, () => assert.fail('Expected a new working copy.'));
			await importLinkedProjectBinChoice({
				getProjectSessionKey: () => editorProjectEditSessionKey(controller, controller.project?.id),
				choose: fileService.chooseLinkedAudioOriginal,
				release: fileService.releaseLinkedAudioOriginal,
				importFile: (file, options) => controller.actions.project.importFiles([file], options),
			}, 'audio');
			await controller.actions.project.save();
			const [source] = controller.project?.sources ?? [];
			assert.ok(source?.kind === 'audio');
			const binding = await environment.store.getLinkedOriginalBinding(projectId, source.id);
			assert.ok(binding?.kind === 'audio');
			locatorId = binding.locatorId;
			await controller.actions.project.clear();
			assert.ok((await environment.controllerStore.listProjects()).some(project => project.id === projectId));
			assert.deepEqual(await environment.store.getLinkedOriginalBinding(projectId, source.id), binding);
		} finally { await initial.close(); }
		const restarted = await open();
		try {
			await restarted.controller.actions.project.openById(projectId);
			const [source] = restarted.controller.project?.sources ?? [];
			assert.ok(source?.kind === 'audio');
			const resolved = await restarted.environment.store.resolveLinkedAudioOriginal(projectId, source);
			assert.ok(resolved);
			assert.equal(resolved.binding.locatorId, locatorId);
			assert.deepEqual(new Uint8Array(await resolved.blob.arrayBuffer()), encoded);
			assert.deepEqual((await restarted.environment.store.readSourceChunk(source.storageKey, 0)).channels[0], samples);
		} finally { await restarted.close(); }
	} finally { await native.close(); }
});

async function writeProjectArchive(directory: string) {
	const library = await openFramescaperImageFixtureLibrary();
	try {
		const project = createFramescaperProject(PROFILE, { id: 'linked-archive', title: 'Field dialogue' });
		const { blob } = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, library.store);
		assert.ok(blob);
		const name = 'Field dialogue.fscape';
		const path = join(directory, name);
		await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
		return new File([await openAsBlob(path)], name);
	} finally { await library.close(); }
}

function linkedFileService(directory: string, path: string) {
	const owner = {};
	const readCapabilities = new ReadCapabilityStore();
	const locators = new DesktopLinkedVideoLocatorStore({ readCapabilities,
		registry: new FileDesktopLinkedVideoLocatorRegistry(join(directory, 'linked-originals.json')) });
	const protocol = createProtocolHandler({ productId: 'framescaper', rendererRoot: directory, runtimeRoot: directory, readCapabilities });
	const handlers = new Map<string, (event: object, value?: unknown) => Promise<unknown>>();
	const releaseRead = (id: string) => readCapabilities.release(id, { owner });
	registerDesktopLinkedVideoLocatorIpc({
		dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [path] }) },
		handle: (channel: string, handler: (event: object, value?: unknown) => Promise<unknown>) => { handlers.set(channel, handler); },
		ownerFor: () => owner, releaseRead, store: locators, windowFor: () => null,
	});
	const invoke = (channel: string, value?: unknown) => {
		const handler = handlers.get(channel);
		assert.ok(handler);
		return handler({}, value);
	};
	const bridge = {
		chooseLinkedAudioOriginal: () => invoke(IPC.chooseLinkedAudioOriginal),
		loadLinkedAudioOriginal: (value: unknown) => invoke(IPC.loadLinkedAudioOriginal, value),
		reconcileLinkedOriginals: (value: unknown) => invoke(IPC.reconcileLinkedOriginals, value),
		releaseLinkedOriginal: (value: unknown) => invoke(IPC.releaseLinkedOriginal, value),
		chooseLinkedVideoOriginal: () => invoke(IPC.chooseLinkedVideoOriginal),
		loadLinkedVideoOriginal: (value: unknown) => invoke(IPC.loadLinkedVideoOriginal, value),
		reconcileLinkedVideoOriginals: (value: unknown) => invoke(IPC.reconcileLinkedVideoOriginals, value),
		releaseLinkedVideoOriginal: (value: unknown) => invoke(IPC.releaseLinkedVideoOriginal, value),
		releaseRead,
	};
	const fileService = createAudioEditorFileService({ bridge, fetch: (url: string, options: RequestInit) => protocol(new Request(url, options)) });
	return { fileService, close: async () => {
		try { await locators.dispose(); } finally { await readCapabilities.dispose(); }
	} };
}
