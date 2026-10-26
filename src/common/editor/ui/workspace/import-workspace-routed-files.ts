/* SPDX-License-Identifier: AGPL-3.0-only */

import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';
import { partitionWorkspaceFiles } from './workspace-file-routing.js';

interface RoutedImportController {
	readonly project?: Readonly<{ id?: unknown }> | null;
	readonly actions: Readonly<{
		readonly project: Readonly<{
			importFiles(files: readonly File[], options: Readonly<Record<string, unknown>>): PromiseLike<unknown> | unknown;
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
		for (const file of routed.projects) await openProjectFile(file);
		if (routed.media.length) {
			const result = await controller.actions.project.importFiles(routed.media, {
				destination: 'auto', projectBinVisible, ...importOptions,
			});
			if (result && typeof result === 'object' && 'cancelled' in result && result.cancelled === true) return 0;
		}
		const projectId = controller.project?.id;
		const failures: unknown[] = [];
		const assertCurrent = (): void => {
			if (controller.project?.id !== projectId) throw new DOMException('The project changed during file import.', 'AbortError');
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
					if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error;
					failures.push(error);
				}
			}
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length) throw new AggregateError(failures, failures.map(error => error instanceof Error ? error.message : String(error)).join('\n'));
		return files.length;
	});
}
