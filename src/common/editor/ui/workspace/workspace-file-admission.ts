/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortablePromise } from '../../../foundation/abort-race.ts';
import { selectAudioEditorBusyBlock, type AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import { useCallback, useEffect, useRef } from 'react';

export interface WorkspaceFileAdmissionController {
	readonly ready?: PromiseLike<unknown> | null;
	getSnapshot?(): AudioEditorEditBlockingSnapshot;
	subscribe?(listener: () => void): () => void;
}

export function useWorkspaceFileAdmission(controller: WorkspaceFileAdmissionController) {
	const scope = useRef<AbortController | null>(null);
	useEffect(() => {
		const owner = new AbortController();
		scope.current = owner;
		return () => { scope.current = null; owner.abort(); };
	}, [controller]);
	return useCallback(async () => {
		const owner = scope.current;
		if (!owner) throw new DOMException('The workspace was closed before opening the file.', 'AbortError');
		await waitForWorkspaceFileAdmission(controller, owner.signal);
	}, [controller]);
}

/** Keep selected files until the editor can admit a new open operation. */
export async function waitForWorkspaceFileAdmission(controller: WorkspaceFileAdmissionController | null, signal: AbortSignal): Promise<void> {
	await raceAbortablePromise(Promise.resolve(controller?.ready), signal);
	signal.throwIfAborted();
	if (!controller?.getSnapshot || !controller.subscribe) return;
	const snapshot = controller.getSnapshot.bind(controller);
	if (!selectAudioEditorBusyBlock(snapshot()).blocked) return;
	const subscribe = controller.subscribe.bind(controller);
	await new Promise<void>((resolve, reject) => {
		let unsubscribe: (() => void) | undefined;
		const settle = (): void => {
			unsubscribe?.();
			unsubscribe = undefined;
			signal.removeEventListener('abort', abort);
		};
		const abort = (): void => { settle(); reject(signal.reason); };
		const check = (): void => {
			if (selectAudioEditorBusyBlock(snapshot()).blocked) return;
			settle();
			resolve();
		};
		// Recheck after registering to cover a publication during subscription.
		unsubscribe = subscribe(() => { if (unsubscribe) check(); });
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		else check();
	});
	signal.throwIfAborted();
}
