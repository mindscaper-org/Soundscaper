/* SPDX-License-Identifier: AGPL-3.0-only */

import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';
import { partitionWorkspaceFiles } from './workspace-file-routing.js';
import { isTimelineInterchangeFile } from '../../timeline-interchange-file.ts';
import { isLegacyAupFile } from '../../controller/shared/app-helpers.ts';
import type { EditorProjectToken } from '../../controller/shared/lifecycle.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import { isExpectedWorkspaceCancellation } from './scape-open-decision-continuation.ts';

interface RoutedImportController {
	readonly project?: Readonly<{ id?: unknown }> | null;
	captureProjectGeneration?(projectId: string | null): EditorProjectToken;
	readonly actions: Readonly<{
		readonly project: Readonly<{
			importFiles(files: readonly File[], options: Readonly<Record<string, unknown>>): PromiseLike<unknown> | unknown;
			openInterchange?(file: File, options: Readonly<{ mediaFiles: readonly File[] }>): PromiseLike<unknown> | unknown;
		}>;
		readonly labels: Readonly<{ importFile(file: File): PromiseLike<unknown> | unknown }>;
	}>;
}

/** One load boundary for picker, drop, launch, and desktop file handoff routes. */
export function importWorkspaceRoutedFiles({
	controller, files, importOptions, openProjectFile, projectBinVisible, requestCueImport,
}: Readonly<{
	controller: RoutedImportController;
	files: readonly File[];
	importOptions: Readonly<Record<string, unknown>>;
	openProjectFile(file: File): PromiseLike<unknown> | unknown;
	projectBinVisible: boolean;
	requestCueImport(file: File): PromiseLike<unknown> | unknown;
}>): Promise<number> {
	return withWebFileLoadLimitContext(async () => {
		const routed = partitionWorkspaceFiles(files);
		const failures: unknown[] = [];
		let companionMedia = false;
		for (const file of routed.projects) {
			try {
				if (isTimelineInterchangeFile(file.name) && controller.actions.project.openInterchange) {
					const result = await controller.actions.project.openInterchange(file, { mediaFiles: routed.media });
					if (importWasCancelled(result)) return 0;
					companionMedia = true;
				} else if (importWasCancelled(await openProjectFile(file))) return 0;
			} catch (error) {
				if (isExpectedWorkspaceCancellation(error)) throw error;
				failures.push(error);
			}
		}
		if (failures.length && failures.length === routed.projects.length) throwImportFailures(failures);
		const activeSession = () => editorProjectEditSessionKey(controller, controller.project?.id);
		let session = activeSession();
		if (routed.media.length && !companionMedia) {
			const result = await controller.actions.project.importFiles(routed.media, {
				destination: 'auto', projectBinVisible, ...importOptions,
			});
			if (importWasCancelled(result)) return 0;
			// A legacy project and its selected audio blocks open through the media importer.
			if (routed.media.some(isLegacyAupFile)) session = activeSession();
		}
		const assertCurrent = (): void => {
			if (activeSession() !== session) throw new DOMException('The project changed during file import.', 'AbortError');
		};
		for (const [group, consume] of [
			[routed.labels, (file: File) => controller.actions.labels.importFile(file)],
			[routed.cues, requestCueImport],
		] as const) {
			for (const file of group) {
				assertCurrent();
				try { await consume(file); assertCurrent(); }
				catch (error) {
					assertCurrent();
					if (isExpectedWorkspaceCancellation(error)) throw error;
					failures.push(error);
				}
			}
		}
		throwImportFailures(failures);
		return files.length;
	});
}

function importWasCancelled(result: unknown): boolean {
	return result != null && typeof result === 'object' && 'cancelled' in result && result.cancelled === true;
}

function throwImportFailures(failures: unknown[]): void {
	if (failures.length === 1) throw failures[0];
	if (failures.length) throw new AggregateError(failures,
		failures.map(error => error instanceof Error ? error.message : String(error)).join('\n'));
}
