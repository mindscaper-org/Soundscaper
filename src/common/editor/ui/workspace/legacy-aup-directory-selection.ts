/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef } from 'react';
import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';

interface LegacyDirectorySelectionRuntime {
	getProjectSessionKey(): string;
	chooseDirectory(): void;
	importFiles(files: readonly File[]): PromiseLike<unknown> | unknown;
}

interface LegacyDirectoryRequest {
	readonly file: File;
	readonly sessionKey: string;
	readonly resolve: (value: unknown) => void;
	readonly reject: (reason: unknown) => void;
}

const CANCELLED = Object.freeze({ cancelled: true as const });

/** The directory chooser continues the exact project activation that selected the AUP. */
export function createLegacyAupDirectorySelection(runtime: LegacyDirectorySelectionRuntime) {
	let pending: LegacyDirectoryRequest | null = null;
	return Object.freeze({
		choose(file: File): Promise<unknown> {
			if (pending) return Promise.reject(new DOMException('A legacy project directory chooser is already open.', 'AbortError'));
			return new Promise((resolve, reject) => {
				pending = { file, sessionKey: runtime.getProjectSessionKey(), resolve, reject };
				try { runtime.chooseDirectory(); }
				catch (error) { pending = null; reject(error); }
			});
		},
		complete(files: readonly File[]): void {
			const request = pending;
			pending = null;
			if (!request) return;
			if (!files.length || request.sessionKey !== runtime.getProjectSessionKey()) {
				request.resolve(CANCELLED);
				return;
			}
			void withWebFileLoadLimitContext(() => runtime.importFiles([request.file, ...files])).then(request.resolve, request.reject);
		},
		cancel(): void {
			const request = pending;
			pending = null;
			request?.resolve(CANCELLED);
		},
	});
}

export function useLegacyAupDirectorySelection(controller: Readonly<{
	getSnapshot(): Readonly<{ project?: Readonly<{ id: string }> | null }>;
	readonly actions: Readonly<{ project: Pick<LegacyDirectorySelectionRuntime, 'importFiles'> }>;
}>) {
	const legacyDataInputRef = useRef<HTMLInputElement>(null);
	const legacyProjectSelection = useMemo(() => createLegacyAupDirectorySelection({
		getProjectSessionKey: () => editorProjectEditSessionKey(controller, controller.getSnapshot().project?.id),
		chooseDirectory: () => {
			const input = legacyDataInputRef.current;
			if (!input) throw new DOMException('The project directory picker is unavailable.', 'AbortError');
			// WebKit does not open the directory chooser through showPicker on file-input continuation.
			input.click();
		},
		importFiles: files => controller.actions.project.importFiles(files),
	}), [controller]);
	useEffect(() => {
		const input = legacyDataInputRef.current;
		input?.addEventListener('cancel', legacyProjectSelection.cancel);
		return () => {
			input?.removeEventListener('cancel', legacyProjectSelection.cancel);
			legacyProjectSelection.cancel();
		};
	}, [legacyProjectSelection]);
	return { legacyDataInputRef, legacyProjectSelection };
}
