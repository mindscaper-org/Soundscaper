/* SPDX-License-Identifier: AGPL-3.0-only */

import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';

interface LegacyDirectorySelectionRuntime {
	getProjectSessionKey(): string;
	chooseDirectory(): void;
	importFiles(files: readonly File[]): PromiseLike<unknown> | unknown;
}

/** The directory chooser continues the exact project activation that selected the AUP. */
export function createLegacyAupDirectorySelection(runtime: LegacyDirectorySelectionRuntime) {
	let pending: Readonly<{ file: File; sessionKey: string }> | null = null;
	return Object.freeze({
		choose(file: File): void {
			pending = { file, sessionKey: runtime.getProjectSessionKey() };
			runtime.chooseDirectory();
		},
		complete(files: readonly File[]): Promise<unknown> {
			const request = pending;
			pending = null;
			if (!request || !files.length || request.sessionKey !== runtime.getProjectSessionKey()) return Promise.resolve(0);
			return withWebFileLoadLimitContext(() => runtime.importFiles([request.file, ...files]));
		},
	});
}
