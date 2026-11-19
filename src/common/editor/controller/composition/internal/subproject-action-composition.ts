/* SPDX-License-Identifier: AGPL-3.0-only */
import { createGroupedEditorActions, type EditorActionRuntime } from '../action-facade.ts';
import type { createControllerBindings } from '../controller-bindings.ts';
import type { createSubprojectActions, SubprojectDocument } from '../../document/subproject-actions.ts';
import type { EnginePublicApi } from '../../../engine/public-api.ts';
import { selectAudioEditorEditBlock } from '../../../edit-blocking.ts';
import { EditorProjectChangedError } from '../../shared/lifecycle.ts';
import { SUBPROJECT_LIBRARY_SETTING } from '../../../subproject-library-setting.ts';

type SubprojectActions = ReturnType<typeof createSubprojectActions>;
type Bindings = ReturnType<typeof createControllerBindings>;

/** Loading an ordinary project does not load the optional background rendering service. */
export function createSubprojectActionComposition(runtime: EditorActionRuntime, bindings: Bindings) {
	let service: Promise<SubprojectActions> | null = null;
	let preparingExport: AbortController | null = null;
	function captureOrigin(): () => void {
		const id = runtime.getProject()?.id;
		const generation = id ? runtime.captureProjectGeneration?.() : undefined;
		return () => {
			if (runtime.getProject()?.id !== id) throw new EditorProjectChangedError();
			if (generation) runtime.assertProjectGeneration?.(generation);
		};
	}
	function load(): Promise<SubprojectActions> {
		service ??= import('../../document/subproject-actions.ts').then(({ createStoredSubprojectActions }) => {
			let library: Promise<string> | null = null;
			return createStoredSubprojectActions({
				getProject: () => runtime.getProject() as SubprojectDocument | null,
				captureGeneration: runtime.captureProjectGeneration,
				assertGeneration: runtime.assertProjectGeneration,
				assertWritable: () => {
					runtime.assertActive?.();
					if (!runtime.capabilities.subprojects) throw new RangeError('This product does not support subprojects.');
					if (selectAudioEditorEditBlock(bindings.getSnapshot()).blocked) throw new Error('Subproject updates are blocked while the project is busy or read-only.');
				},
				loadProject: async id => await runtime.store.loadProject(id) as SubprojectDocument | null,
				listProjects: () => runtime.store.listProjects(),
				getLibraryId: () => library ??= (async () => {
					const repository = runtime.store.settingsRepository;
					let id: unknown = await repository.get(SUBPROJECT_LIBRARY_SETTING);
					if (id === undefined) {
						await repository.putIfAbsent(SUBPROJECT_LIBRARY_SETTING, runtime.createStableId('library'));
						id = await repository.get(SUBPROJECT_LIBRARY_SETTING);
					}
					if (typeof id !== 'string' || !id) throw new Error('The project library identity is unavailable.');
					return id;
				})().finally(() => { library = null; }),
				commit: runtime.commit,
				createId: runtime.createStableId,
				openProject: id => actions.project.openById(id),
				prepare: () => actions.project.flush({ prepareCurrentSnapshot: true }),
				reportError: runtime.handleError,
				wait: signal => new Promise((resolve, reject) => {
					const cancel = (): void => { clearTimeout(timer); reject(signal.reason); };
					const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 1500);
					if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
				}),
				renderer: { store: runtime.store, createId: runtime.createStableId,
					createEngine: () => bindings.createCacheAwareRenderEngine() as EnginePublicApi,
					projectForRuntimeConsumers: project => runtime.projectForRuntimeConsumers?.(project) ?? project,
					preflight: bytes => bindings.preflightStorage(bytes, 'project'),
				},
			});
		}).catch((error: unknown) => { service = null; throw error; });
		return service;
	}
	const invoke = <Key extends keyof SubprojectActions>(key: Key) => async (...args: Parameters<SubprojectActions[Key]>): Promise<Awaited<ReturnType<SubprojectActions[Key]>>> => {
		const assertOrigin = key === 'libraryId' ? null : captureOrigin();
		const owner = await load();
		assertOrigin?.();
		const operation = owner[key] as (...values: Parameters<SubprojectActions[Key]>) => ReturnType<SubprojectActions[Key]>;
		return await operation(...args) as Awaited<ReturnType<SubprojectActions[Key]>>;
	};
	const subprojects = Object.freeze({ libraryId: invoke('libraryId'), candidates: invoke('candidates'), add: invoke('add'), refresh: invoke('refresh'), relink: invoke('relink'),
		follow: invoke('follow'), detach: invoke('detach'), open: invoke('open'), watch: invoke('watch') });
	const refreshForDelivery = async (signal?: AbortSignal): Promise<void> => {
		// A read-only copy carries the installed proxy without authority to publish child updates.
		if (bindings.getSnapshot().readOnly) return;
		const project = runtime.getProject();
		const metadata = project?.metadata as { subprojects?: readonly unknown[] } | undefined;
		if (metadata?.subprojects?.length) await subprojects.refresh({ signal });
	};
	const actions = createGroupedEditorActions({ ...runtime, handleExportAction: async (...args) => {
		if (args[0] === 'cancel') preparingExport?.abort();
		if (args[0] !== 'start') return runtime.handleExportAction(...args);
		const assertOrigin = captureOrigin();
		preparingExport?.abort();
		const request = new AbortController();
		preparingExport = request;
		try {
			await refreshForDelivery(request.signal);
			request.signal.throwIfAborted();
			assertOrigin();
		} finally {
			if (preparingExport === request) preparingExport = null;
		}
		return runtime.handleExportAction(...args);
	} });
	const prepareArchive = <Args extends unknown[], Result>(operation: (...args: Args) => Result) => async (...args: Args): Promise<Awaited<Result>> => {
		const assertOrigin = captureOrigin();
		await refreshForDelivery();
		assertOrigin();
		return await operation(...args);
	};
	return Object.freeze({ ...actions, subprojects, project: Object.freeze({ ...actions.project,
		save: prepareArchive(actions.project.save), saveAup3: prepareArchive(actions.project.saveAup3),
		saveAup4: prepareArchive(actions.project.saveAup4), saveDawproject: prepareArchive(actions.project.saveDawproject),
		saveScape: prepareArchive(actions.project.saveScape), saveAs: prepareArchive(actions.project.saveAs),
		saveFile: prepareArchive(actions.project.saveFile), prepareHandoff: prepareArchive(actions.project.prepareHandoff),
	}) });
}
