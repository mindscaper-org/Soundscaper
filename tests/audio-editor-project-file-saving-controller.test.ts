/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { IPC } from '../desktop/constants.js';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';
import { OriginalFileOverwriteStore } from '../desktop/original-file-overwrite.ts';
import { ProjectFileAssociations } from '../desktop/project-file-associations.ts';
import { registerProjectSavingIpc } from '../desktop/project-saving-main-ipc.ts';
import type { TemporaryProjectStorage } from '../desktop/temporary-project-storage.ts';
import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';
import { acceptsFile } from '../desktop/validation.js';
import { COPY, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { createProjectSavingPreload } from '../desktop/project-saving-preload.ts';
import { bindProjectFileSaving, createControllerFileSavingRuntime } from '../src/common/editor/controller/document/project-file-saving-composition.ts';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperEphemeralProjectStore, createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { settle } from './helpers/async-test-control.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
const { createAudioEditorController } = await import('../src/common/editor/app.js');
type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

test('desktop controller saves an opened Scape to its original and asks only about later file changes', async t => {
	const memory = createMemoryStore();
	const store = Object.assign(memory, { async deleteProjectSnapshot(project: { id: string }) { return memory.projects.delete(project.id); } }), decisions: string[] = [], targets: unknown[] = [], prompts: Readonly<{ message: string }>[] = [];
	const original = { id: 'a'.repeat(48), name: 'original.sscape' };
	const { confirmProjectSave } = createProjectSavingPreload({
		invoke: async (_channel, request) => {
			prompts.push(request as Readonly<{ message: string }>);
			return decisions.shift() ?? 'cancel';
		},
		send: () => undefined,
	}, { opaqueId: String, original: value => value, boolean: Boolean });
	const fileService = createAudioEditorFileService({ bridge: {
		prepareOriginalOverwrite: async (id: string) => { targets.push(id); return { id: 'b'.repeat(48), name: original.name }; },
		confirmProjectSave,
		rememberProjectFile: async () => undefined, restoreProjectFile: async () => null, releaseOriginalFile: async () => true,
		beginWrite: async () => ({ writeId: 'write', chunkSize: 1024 }),
		writeChunk: async (request: { offset: number; bytes: Uint8Array }) => ({ nextOffset: request.offset + request.bytes.length }),
		finishWrite: async () => ({ byteLength: 4 }),
	} });
	const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en', store: store as unknown as Options['store'], engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], fileService, scapeProjectRuntime: {
			importScapeProject: async () => {
				const project = { ...structuredClone(controller.project!), id: 'imported-project', title: 'Imported project' };
				await store.saveProject(project);
				return { project, manifest: {}, readOnly: false, collision: null };
			},
			exportScapeProject: async (_project: unknown, _store: unknown, options: { createWritable?: (size: number) => Promise<WritableStream<Uint8Array>> }) => {
				if (options.createWritable) { const writable = await options.createWritable(4); const writer = writable.getWriter(); await writer.write(new Uint8Array(4)); await writer.close(); return { blob: null, manifest: {}, byteLength: 4 }; }
				return { blob: new Blob(['data']), manifest: {}, byteLength: 4 };
			},
		} });
	t.after(() => controller.dispose());
	await controller.ready;
	assert.equal(controller.getSnapshot().preferences.saving?.autoSaving, false);
	assert.equal(await controller.actions.project.prepareClose(), true, 'a fresh empty project does not prompt');
	assert.equal(prompts.length, 0);
	const file = new File(['archive'], original.name); registerDesktopOriginalFile(file, original);
	await controller.actions.project.openScape(file);
	assert.equal(await controller.actions.project.prepareClose(), true);
	const title = `Edited $&: ${'🎙️'.repeat(400)}`;
	await controller.actions.project.rename(title);
	await controller.actions.project.flush();
	decisions.push('cancel'); assert.equal(await controller.actions.project.prepareClose(), false);
	assert.equal(prompts.length, 1);
	assert.match(prompts[0]?.message ?? '', /Edited \$&: 🎙️/u);
	assert.doesNotMatch(prompts[0]?.message ?? '', /\p{Surrogate}/u);
	assert.match(prompts[0]?.message ?? '', /…” before closing\?$/u);
	assert.equal(controller.project?.title, title);
	await controller.actions.project.save(); assert.deepEqual(targets, [], 'internal publication does not write a project file');
	await controller.actions.project.saveFile(); assert.deepEqual(targets, [original.id]);
	assert.equal(await controller.actions.project.prepareClose(), true);
	assert.equal(prompts.length, 1);
	await controller.actions.project.rename('Discarded edit');
	await controller.actions.project.flush();
	decisions.push('discard');
	assert.equal(await controller.actions.project.prepareClose(), true);
	assert.equal(store.projects.has('imported-project'), false);
	assert.deepEqual(targets, [original.id], 'discard leaves the original file untouched');
});

test('file-saving observations and close checks do not clone session undo histories', async t => {
	const project = createSoundscaperProject({ id: 'edit-with-history', title: 'Present' });
	const prior = { ...project, title: 'Previous' };
	const session = createAudioEditorSessionController({
		currentSchemaVersion: project.schemaVersion,
		projects: [{ project, history: {
			limit: 200, present: project, undoStack: [{ project: prior, command: { type: 'project/rename' } }], redoStack: [],
		} }],
	});
	let observe = () => {};
	const signal = new AbortController();
	t.after(() => { signal.abort(); session.dispose(); });
	const runtime = createControllerFileSavingRuntime({
		session, signal: signal.signal,
		store: { listProjects: async () => [], loadProject: async () => null, deleteProjectSnapshot: async () => false },
		preferences: () => ({ saving: { autoSaving: false, askBeforeClosing: true },
			temporaryData: { limitProjects: false, maximumProjects: 10 } }),
		switchProject: () => undefined, closeProject: () => undefined,
		acquire: async () => ({ readOnly: false, release() {} }),
		subscribe(listener) { observe = listener; return () => {}; }, handleError: error => { throw error; },
	});
	bindProjectFileSaving({ runtime, fileService: { isDesktop: true }, copy: {}, getProject: () => project,
		flush: () => undefined, write: async () => ({}) });
	const clone = structuredClone;
	const cloneHistory = t.mock.method(globalThis, 'structuredClone', (value: unknown) => clone(value));
	const materialized = (key: string) => cloneHistory.mock.calls.some(({ arguments: [value] }) => (
		typeof value === 'object' && value !== null && Object.hasOwn(value, key)
	));

	observe();
	await settle();
	assert.equal(materialized('undoStack'), false, 'an ordinary document publication only uses open tab IDs');
	assert.equal(materialized('schemaFamily'), false, 'an ordinary document publication does not copy the present either');
	const views = runtime.getProjects();
	assert.equal(views[0]?.project.title, 'Present');
	assert.equal(runtime.getProjects(), views);
	session.setProjectReadOnly(project.id, true);
	assert.equal(runtime.getProjects()[0]?.readOnly, true);
	assert.equal(materialized('undoStack'), false, 'close checks can read present documents independently');
});

test('a file save clones only the target document and rechecks write admission from tab metadata', async t => {
	const project = createSoundscaperProject({ id: 'write-project', title: 'Present' });
	const other = createSoundscaperProject({ id: 'other-project', title: 'Other recording' });
	const session = createAudioEditorSessionController({ currentSchemaVersion: project.schemaVersion, projects: [other, project] });
	const signal = new AbortController();
	t.after(() => { signal.abort(); session.dispose(); });
	const reads: string[] = [];
	const runtime = createControllerFileSavingRuntime({
		session: { getSnapshot: session.getSnapshot, getProject(id) { reads.push(id); return session.getProject(id); } },
		signal: signal.signal,
		store: { listProjects: async () => [], loadProject: async () => null, deleteProjectSnapshot: async () => false },
		preferences: () => ({ saving: { autoSaving: false, askBeforeClosing: true },
			temporaryData: { limitProjects: false, maximumProjects: 10 } }),
		switchProject() {}, closeProject() {}, acquire: async () => ({ readOnly: false, release() {} }),
		subscribe: () => () => {}, handleError: error => { throw error; },
	});
	const saving = bindProjectFileSaving({ runtime, fileService: { isDesktop: true }, copy: {}, getProject: () => project,
		flush() {}, write: async (captured, _target, assertWritable) => {
			assert.equal(captured.id, project.id);
			assert.equal(captured.title, 'Present');
			session.updateProjectMetadata(other.id, { playheadFrame: 42 });
			assertWritable();
			return {};
		} });
	await saving.service.opened(project, {});
	assert.equal(await saving.service.save(), true);
	assert.deepEqual(reads, [project.id]);

	reads.length = 0;
	const captured = runtime.getWritableProject(project.id);
	assert.equal(runtime.getWritableProject(project.id), captured);
	assert.equal(runtime.getProjects().find(entry => entry.project.id === project.id)?.project, captured);
	assert.deepEqual(reads, [project.id, other.id]);
	session.setProjectReadOnly(project.id, true);
	assert.equal(runtime.isProjectWritable(project.id), false);
	assert.equal(runtime.getWritableProject(project.id), null);
	session.closeProject(project.id);
	assert.equal(runtime.getWritableProject(project.id), null);
	assert.deepEqual(reads, [project.id, other.id]);
	session.openProject({ ...project, title: 'Replacement' });
	assert.equal(runtime.getWritableProject(project.id)?.title, 'Replacement');
	assert.equal(captured?.title, 'Present');
});

test('Save uses a new destination after a read-only Scape reopen or an external replacement', async t => {
	const folder = await mkdtemp(join(tmpdir(), 'scape-replaced-file-binding-'));
	const writablePath = join(folder, 'First draft.sscape'), readOnlyPath = join(folder, 'Reference draft.sscape');
	const destination = join(folder, 'New edit.sscape'), registryPath = join(folder, 'associations.json');
	const fallback = join(folder, 'Saved from close.sscape');
	let savePath: string | null = destination;
	let closeResponse = 2, pickCount = 0;
	const exportStore = createSoundscaperEphemeralProjectStore(), scapeProjectRuntime = createSoundscaperScapeNativeRuntime();
	const indexedDB = createInstrumentedIndexedDB();
	const reads = new ReadCapabilityStore(), targets = new SaveTargetStore(), saves = new AtomicSaveManager({ targets } as never);
	const originals = new OriginalFileOverwriteStore({ reads, targets, acceptsFile, cleanDisplayName: value => value, maximumCount: 10 });
	t.after(async () => {
		originals.dispose();
		await Promise.all([reads.dispose(), saves.dispose(), exportStore.close()]);
		await chmod(readOnlyPath, 0o600).catch(() => undefined);
		await rm(folder, { recursive: true, force: true });
	});
	const id = 'same-project';
	const written = new Map<string, Buffer>();
	for (const [path, title] of [[writablePath, 'First draft'], [readOnlyPath, 'Reference draft']] as const) {
		const { blob } = await scapeProjectRuntime.exportScapeProject(createSoundscaperProject({ id, title }), exportStore);
		assert.ok(blob);
		const bytes = Buffer.from(await blob.arrayBuffer());
		await writeFile(path, bytes);
		written.set(path, bytes);
	}
	await chmod(readOnlyPath, 0o400);
	const first = await launch();
	try {
		await first.open(writablePath, true);
		const restored = (await first.registry.restore(id, first.owner))?.originalFile;
		assert.ok(restored);
		assert.ok(originals.release(restored.id, { owner: first.owner }));
		await first.open(readOnlyPath, false);
		assert.equal(first.controller.project?.title, 'Reference draft');
	} finally { await first.controller.dispose(); }

	const next = await launch();
	try {
		await next.controller.actions.project.openById(id);
		assert.equal(next.controller.project?.title, 'Reference draft');
		const closeUnchanged = await next.controller.actions.project.prepareClose();
		await next.controller.actions.project.rename('New edit');
		assert.equal(await next.controller.actions.project.saveFile(), true);
		assert.deepEqual(await readFile(writablePath), written.get(writablePath), 'the previous archive keeps its original bytes');
		assert.deepEqual(await readFile(readOnlyPath), written.get(readOnlyPath), 'the reference archive keeps its original bytes');
		assert.equal(closeUnchanged, true, 'the replacement is the saved baseline');
		const saved = await scapeProjectRuntime.inspectScapeProject(new Blob([await readFile(destination)]), null,
			{ signal: new AbortController().signal }, { retain() {} });
		assert.equal(saved.title, 'New edit');

		const replacement = join(folder, 'Replacement.sscape');
		const independent = written.get(writablePath)!;
		await writeFile(replacement, independent);
		await rename(replacement, destination);
		await next.controller.actions.project.rename('Edited after external replacement');

		await next.controller.actions.preferences.update({ saving: { autoSaving: true } });
		const picksBeforeClose = pickCount;
		assert.equal(await next.controller.actions.project.prepareClose(), false);
		assert.equal(pickCount, picksBeforeClose, 'autosave never opens the destination picker');
		await next.controller.actions.preferences.update({ saving: { autoSaving: false } });

		savePath = null;
		closeResponse = 0;
		assert.equal(await next.controller.actions.project.prepareClose(), false, 'cancel keeps the project open');
		assert.deepEqual(await readFile(destination), independent);
		savePath = fallback;
		assert.equal(await next.controller.actions.project.prepareClose(), true);
		assert.deepEqual(await readFile(destination), independent, 'Save never overwrites an independent replacement');
		const rescued = await scapeProjectRuntime.inspectScapeProject(new Blob([await readFile(fallback)]), null,
			{ signal: new AbortController().signal }, { retain() {} });
		assert.equal(rescued.title, 'Edited after external replacement');
	} finally { await next.controller.dispose(); }

	async function launch() {
		const owner = {}, registry = new ProjectFileAssociations(registryPath, originals);
		const store = createSoundscaperProjectStore({ indexedDB, preferOpfs: false });
		await registry.load();
		const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
		const handle = (channel: string, handler: (event: unknown, value: unknown) => unknown) => { handlers.set(channel, handler); };
		registerProjectSavingIpc({ channels: IPC, ownerFor: () => owner, files: registry,
			handle, storage: {} as TemporaryProjectStorage,
			chooseFolder: async () => null, prompt: async () => ({ response: closeResponse }) });
		registerFileCapabilityIpc({ channels: IPC, ownerFor: () => owner, handle,
			desktopSmokeProbe: { resolveSavePath: () => null }, dialog: { async showSaveDialog() {
				pickCount++;
				return savePath === null ? { canceled: true } : { filePath: savePath, canceled: false };
			} },
			opaqueId: String, pendingOpenProjects: { dispatch() {} }, readCapabilities: reads, saveTargets: targets, saves, originalFiles: originals,
			windowFor: () => null });
		const invoke = async (channel: string, request?: unknown) => handlers.get(channel)!(null, request);
		const preload = createProjectSavingPreload({
			invoke, send: () => undefined,
		}, { opaqueId: String, original: value => value, boolean: Boolean });
		const fileOperations = ['chooseSaveTarget', 'beginWrite', 'writeChunk', 'patchFinalPrefix', 'finishWrite', 'abortWrite'] as const;
		const fileService = createAudioEditorFileService({ bridge: {
			...preload, ...Object.fromEntries(fileOperations.map(name => [name, (value: unknown) => invoke(IPC[name], value)])),
		} });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', copy: COPY, locale: 'en',
			store, projectRuntime: runtime, sessionController: runtime.createSessionController(), fileService, scapeProjectRuntime,
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		await controller.ready;
		return { controller, owner, registry, async open(path: string, expectWritable: boolean) {
			const selection = await reads.registerScapeRangePath(path, { owner });
			const original = await originals.registerRead(selection.id, { owner });
			await reads.release(selection.id, { owner });
			assert.equal(original !== null, expectWritable);
			const file = new File([await readFile(path)], basename(path));
			if (original) registerDesktopOriginalFile(file, original);
			await controller.actions.project.openScapeFile(file, request => {
				assert.equal(request.kind, 'collision');
				return 'replace';
			});
		} };
	}
});

test('closing a reopened project with only a saved library edit still asks for a project file', async t => {
	const store = createSoundscaperEphemeralProjectStore();
	const runtime = createSoundscaperProjectRuntimeSelection();
	const edited = applySoundscaperProjectCommand(createSoundscaperProject({ id: 'only-renamed' }), {
		type: 'project/rename', title: 'My dialogue template',
	});
	await store.saveProject(edited);
	const prompts: string[] = [];
	const fileService = createAudioEditorFileService({ bridge: {
		async confirmProjectSave(request: { message: string }) { prompts.push(request.message); return 'cancel'; },
	} });
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', copy: COPY, locale: 'en',
		store, projectRuntime: runtime, sessionController: runtime.createSessionController(), fileService,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	t.after(() => controller.dispose());
	await controller.ready;
	await controller.actions.project.openById(edited.id);
	assert.equal(controller.project?.title, edited.title);
	assert.equal(await controller.actions.project.prepareClose(), false);
	assert.match(prompts[0] ?? '', /My dialogue template/u);
});
