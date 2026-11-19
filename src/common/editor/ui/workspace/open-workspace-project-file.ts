/* SPDX-License-Identifier: AGPL-3.0-only */

import { annotateFormatFileFailure } from '../../format-file-parser-failure.ts';
import { isScapeProjectFile } from '../../scape-project-format.ts';
import { isTimelineInterchangeFile } from '../../timeline-interchange-file.ts';
import { isWorkspaceImportFile, partitionWorkspaceFiles } from './workspace-file-routing.js';
import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';
import type { OpenLabelProject } from '../../controller/edit/edit-composition.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';

interface ProjectFileController {
	readonly ready: PromiseLike<unknown>;
	readonly project?: Readonly<{ id: string }> | null;
	readonly actions: {
		readonly project: {
			openAudacityProject(file: File): unknown;
			openDawproject(file: File): unknown;
			openSesx?(file: File): unknown;
			openInterchange?(file: File): unknown;
			create?(options: Readonly<{ title: string }>): ReturnType<OpenLabelProject>;
			importFiles?(files: readonly File[], options: Readonly<{ destination: 'timeline' }>): unknown;
			remove?(id: string, options: Readonly<{ project: object; restoreProjectId?: string }>): unknown;
		};
		readonly labels?: { readonly importFile: (file: File, options: Readonly<{ openProject: OpenLabelProject }>) => unknown };
	};
}

export function openWorkspaceProjectFile(...args: Parameters<typeof routeWorkspaceProjectFile>): Promise<unknown> {
	return withWebFileLoadLimitContext(() => routeWorkspaceProjectFile(...args));
}

async function routeWorkspaceProjectFile(
	controller: ProjectFileController,
	file: File,
	openScape: (file: File) => unknown,
	openLegacyAup?: (file: File) => unknown,
	desktopSesx = false,
	openCueFile?: (file: File, prepareProject: OpenLabelProject) => unknown,
): Promise<unknown> {
	// The file picker and drop target mount before the initial project exists.
	await controller.ready;
	if (/\.aup$/iu.test(file.name) && openLegacyAup) return openLegacyAup(file);
	if (isScapeProjectFile(file)) return openScape(file);
	if (isTimelineInterchangeFile(file.name)) {
		if (!controller.actions.project.openInterchange) throw new TypeError('Timeline interchange import is unavailable.');
		return controller.actions.project.openInterchange(file);
	}
	if (/\.dawproject$/iu.test(file.name)) return controller.actions.project.openDawproject(file);
	if (/\.sesx?$/iu.test(file.name)) {
		const format = /\.ses$/iu.test(file.name) ? 'SES' : 'SESX';
		if (!desktopSesx) {
			const error = new Error(`Adobe Audition ${format} import requires the desktop app.`);
			throw format === 'SESX' ? annotateFormatFileFailure(error, 'sesx', 'DESKTOP_REQUIRED') : error;
		}
		if (!controller.actions.project.openSesx) {
			const error = new Error(`Adobe Audition ${format} import is unavailable.`);
			throw format === 'SESX' ? annotateFormatFileFailure(error, 'sesx', 'UNAVAILABLE') : error;
		}
		return controller.actions.project.openSesx(file);
	}
	if (/\.aup(?:[34]|4unsaved)$/iu.test(file.name)) return controller.actions.project.openAudacityProject(file);
	if (!isWorkspaceImportFile(file)) throw new TypeError('Choose a supported project or import file.');
	const routed = partitionWorkspaceFiles([file]);
	const { create } = controller.actions.project;
	if (!create) throw new TypeError('Creating a project for File Open is unavailable.');
	if (routed.media.length && !controller.actions.project.importFiles) throw new TypeError('Media import is unavailable.');
	if (routed.labels.length && !controller.actions.labels?.importFile) throw new TypeError('Label import is unavailable.');
	if (routed.cues.length && !openCueFile) throw new TypeError('CUE import is unavailable.');
	if (routed.media.length && file.size === 0) throw new RangeError('The selected media file is empty.');
	const title = file.name.replace(/\.[^.]+$/u, '') || file.name;
	const openProject = () => create({ title });
	if (routed.cues.length) return openCueFile?.(file, openProject);
	if (routed.labels.length) return controller.actions.labels?.importFile(file, { openProject });
	const restoreProjectId = controller.project?.id;
	const id = await openProject();
	const project = controller.project;
	if (project && project.id !== id) throw new DOMException('The project changed before the file could be imported.', 'AbortError');
	const session = editorProjectEditSessionKey(controller, id);
	const retireUnusedProject = async (): Promise<void> => {
		if (project && controller.project === project && editorProjectEditSessionKey(controller, id) === session) {
			await controller.actions.project.remove?.(id, { project, restoreProjectId });
		}
	};
	let result: unknown;
	try { result = await controller.actions.project.importFiles?.([file], { destination: 'timeline' }); }
	catch (error) {
		try { await retireUnusedProject(); }
		catch (cleanupError) { throw new AggregateError([error, cleanupError], 'File Open and cleanup of its unused project both failed.', { cause: cleanupError }); }
		throw error;
	}
	await retireUnusedProject();
	return result;
}
