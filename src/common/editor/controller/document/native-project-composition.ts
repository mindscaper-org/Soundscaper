import { bindProjectFileSaving, type ProjectFileSavingRuntime } from './project-file-saving-composition.ts';
import { beginNativeScapeSave, publishNativeScape } from './internal/native-project/native-scape-save.ts';
/* SPDX-License-Identifier: AGPL-3.0-only */

import { withProjectFileExtension } from '../../../project-file-extensions.ts';
import { createStableId } from '../../project.js';
import { SCAPE_MIME_TYPE } from '../../scape-project-format.ts';
import { loadStoredSourceChannels } from '../../clip-time-pitch-cache-channels.js';
import { applicationVersion } from '../../application-version.ts';
import { aup4ReportHasMissingPcm, ensureAup3FileName, ensureAup4FileName, normalizeAup4CompatibilityReport } from '../shared/app-helpers.ts';
import type { ProjectSchemaFamily } from '../../project-schema-identity.ts';
import { deferredArchiveRuntime } from './deferred-archive-runtime.ts';
import { createNativeProjectService, type NativeProjectServiceRuntime } from './native-project-service.ts';
import type { EditorTaskProgressCoordinator } from '../shared/task-progress.ts';
import { SOURCE_CHUNK_FRAMES, sourcePcmBytes } from '../source/source-audio.ts';

type DefaultPort =
	| 'createStableId' | 'ensureAup3FileName' | 'ensureAup4FileName' | 'ensureProjectFileName' | 'sourcePcmBytes'
	| 'loadStoredSourceChannels' | 'requestAup3FileHandle' | 'requestAup4FileHandle'
	| 'saveAup3Result' | 'saveAup4Result' | 'createAup4Client'
	| 'normalizeCompatibilityReport' | 'reportHasMissingPcm' | 'sourceChunkFrames'
	| 'scapeMimeType' | 'applicationVersion';

export type NativeProjectCompositionDependencies = Omit<NativeProjectServiceRuntime, DefaultPort | 'taskProgress' | 'copy' | 'copyFutureScapeArchive'> & Readonly<{
	currentProjectSchemaFamily: ProjectSchemaFamily;
	fileSaving?: ProjectFileSavingRuntime;
	copyFutureScapeArchive?: NativeProjectServiceRuntime['copyFutureScapeArchive'];
	taskProgress: EditorTaskProgressCoordinator;
	copy: NativeProjectServiceRuntime['copy'] & Readonly<{ projectSaving: string }>;
}>;

/** Bind shared archive machinery once; product-specific publication remains injected. */
export function createNativeProjectComposition(dependencies: NativeProjectCompositionDependencies) {
	const service = createNativeProjectService({
		...dependencies,
		onScapeOpened: (project, input) => saving.opened(project, input),
		onScapeSaved: (project, result) => saving.saved(project, result),
		copyFutureScapeArchive: dependencies.copyFutureScapeArchive ?? ((input, write, options) => (
			deferredArchiveRuntime.copyFutureScapeArchive(input, write, {
				...options, currentProjectSchemaFamily: dependencies.currentProjectSchemaFamily,
			})
		)),
		createStableId, ensureAup3FileName, ensureAup4FileName, ensureProjectFileName: withProjectFileExtension,
		sourcePcmBytes, loadStoredSourceChannels,
		requestAup4FileHandle: deferredArchiveRuntime.requestAup4FileHandle,
		requestAup3FileHandle: deferredArchiveRuntime.requestAup3FileHandle,
		saveAup4Result: deferredArchiveRuntime.saveAup4Result,
		saveAup3Result: deferredArchiveRuntime.saveAup3Result,
		createAup4Client: deferredArchiveRuntime.createAup4Client,
		normalizeCompatibilityReport: normalizeAup4CompatibilityReport,
		reportHasMissingPcm: aup4ReportHasMissingPcm,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES, scapeMimeType: SCAPE_MIME_TYPE,
		applicationVersion: applicationVersion(),
	});
	const saving = bindProjectFileSaving({
		runtime: dependencies.fileSaving, fileService: dependencies.fileService, copy: dependencies.copy,
		getProject: dependencies.getProject, flush: () => dependencies.flushProject({ prepareCurrentSnapshot: true, preparationPurpose: 'scape-save' }),
		write: async (project, target) => {
			if (dependencies.hasMissingTimelineSources(project)) throw new Error(dependencies.copy.missingSourcesPreventSave);
			const runtime = { ...dependencies, ensureProjectFileName: withProjectFileExtension, scapeMimeType: SCAPE_MIME_TYPE };
			const task = dependencies.lifetime.startTask('project-file-save');
			try {
				const { fileName, prepared } = await beginNativeScapeSave(runtime, { fallbackFileName: project.title, options: { saveTarget: target }, signal: task.signal });
				if (prepared.mode === 'cancelled') return { cancelled: true };
				return (await publishNativeScape(runtime, { project, fileName, prepared, signal: task.signal, assertReadyToCommit: () => task.assertCurrent() })).saved;
			} finally { task.finish(); }
		},
	});
	const { taskProgress, copy } = dependencies;
	const openAudacityProject = (...args: Parameters<typeof service.openAudacityProject>) => (
		taskProgress.run('project-io', copy.importing, () => service.openAudacityProject(...args), undefined, { key: "importing" })
	);
	return Object.freeze({
		...service, openAudacityProject, openAup4: openAudacityProject,
		saveProjectFile: saving.service.save, prepareFileClose: saving.service.prepareClose,
		openScape: (...args: Parameters<typeof service.openScape>) => (
			taskProgress.run('project-io', copy.importing, () => service.openScape(...args), undefined, { key: "importing" })
		),
		saveScape: (...args: Parameters<typeof service.saveScape>) => (
			taskProgress.run('project-io', copy.projectSaving, () => service.saveScape(...args), undefined, { key: "projectSaving" })
		),
		saveAup4: (...args: Parameters<typeof service.saveAup4>) => (
			taskProgress.run('project-io', copy.aup4Saving, () => service.saveAup4(...args), undefined, { key: "aup4Saving" })
		),
		saveAup3: (...args: Parameters<typeof service.saveAup3>) => (
			taskProgress.run('project-io', copy.aup3Saving, () => service.saveAup3(...args), undefined, { key: "aup3Saving" })
		),
	});
}
