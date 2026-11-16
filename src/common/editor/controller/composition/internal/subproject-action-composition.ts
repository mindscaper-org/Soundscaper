/* SPDX-License-Identifier: AGPL-3.0-only */
import { createGroupedEditorActions, type EditorActionRuntime } from '../action-facade.ts';
import type { createControllerBindings } from '../controller-bindings.ts';
import type { createSubprojectActions, SubprojectDocument } from '../../document/subproject-actions.ts';
import type { EnginePublicApi } from '../../../engine/public-api.ts';
import { selectAudioEditorEditBlock } from '../../../edit-blocking.ts';

type SubprojectActions = ReturnType<typeof createSubprojectActions>;
type Bindings = ReturnType<typeof createControllerBindings>;

/** Loading an ordinary project does not load the optional background rendering service. */
export function createSubprojectActionComposition(runtime: EditorActionRuntime, bindings: Bindings) {
	let service: Promise<SubprojectActions> | null = null;
	function load(): Promise<SubprojectActions> {
		service ??= import('../../document/subproject-actions.ts').then(({ createStoredSubprojectActions }) => {
			let library: Promise<string> | null = null;
			return createStoredSubprojectActions({
				getProject: () => runtime.getProject() as SubprojectDocument | null,
				assertWritable: () => {
					runtime.assertActive?.();
					if (!runtime.capabilities.subprojects) throw new RangeError('This product does not support subprojects.');
					if (selectAudioEditorEditBlock(bindings.getSnapshot()).blocked) throw new Error('Subproject updates are blocked while the project is busy or read-only.');
				},
				loadProject: async id => await runtime.store.loadProject(id) as SubprojectDocument | null,
				listProjects: () => runtime.store.listProjects(),
				getLibraryId: () => library ??= (async () => {
					const repository = runtime.store.settingsRepository, key = 'soundscaper.subproject-library-id.v1';
					await repository.putIfAbsent(key, runtime.createStableId('library'));
					const id: unknown = await repository.get(key);
					if (typeof id !== 'string' || !id) throw new Error('The project library identity is unavailable.');
					return id;
				})(),
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
		const owner = await load();
		const operation = owner[key] as (...values: Parameters<SubprojectActions[Key]>) => ReturnType<SubprojectActions[Key]>;
		return await operation(...args) as Awaited<ReturnType<SubprojectActions[Key]>>;
	};
	const subprojects = Object.freeze({ libraryId: invoke('libraryId'), candidates: invoke('candidates'), add: invoke('add'), refresh: invoke('refresh'), relink: invoke('relink'),
		follow: invoke('follow'), detach: invoke('detach'), open: invoke('open'), watch: invoke('watch') });
	const refreshForDelivery = async (): Promise<void> => {
		const project = runtime.getProject();
		const metadata = project?.metadata as { subprojects?: readonly unknown[] } | undefined;
		if (metadata?.subprojects?.length) await subprojects.refresh();
	};
	const actions = createGroupedEditorActions({ ...runtime, handleExportAction: async (...args) => {
		if (args[0] === 'start') await refreshForDelivery();
		return runtime.handleExportAction(...args);
	} });
	const prepareArchive = <Args extends unknown[], Result>(operation: (...args: Args) => Result) => async (...args: Args): Promise<Awaited<Result>> => {
		await refreshForDelivery(); return await operation(...args);
	};
	return Object.freeze({ ...actions, subprojects, project: Object.freeze({ ...actions.project,
		save: prepareArchive(actions.project.save), saveAup3: prepareArchive(actions.project.saveAup3),
		saveAup4: prepareArchive(actions.project.saveAup4), saveDawproject: prepareArchive(actions.project.saveDawproject),
		saveScape: prepareArchive(actions.project.saveScape), saveAs: prepareArchive(actions.project.saveAs),
		saveFile: prepareArchive(actions.project.saveFile), prepareHandoff: prepareArchive(actions.project.prepareHandoff),
	}) });
}
