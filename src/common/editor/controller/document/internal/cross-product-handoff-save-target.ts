/* SPDX-License-Identifier: AGPL-3.0-only */

import { boundCrossProductHandoffArchiveFileName,
	crossProductHandoffReportSidecarFileName } from '../../../../transfer/cross-product-handoff-report-sidecar.ts';

export interface HandoffSaveRequest {
	readonly purpose: 'project-copy' | 'report';
	readonly blob: Blob;
	readonly suggestedName: string;
	readonly mimeType: string;
	readonly signal: AbortSignal;
	readonly useFileSystemAccess: boolean;
	readonly target?: unknown;
}
export interface HandoffSavePort {
	saveFile(request: Readonly<HandoffSaveRequest>): PromiseLike<unknown> | unknown;
	chooseSaveTarget?(request: Readonly<HandoffSaveRequest>): PromiseLike<unknown> | unknown;
	releaseSaveTarget?(target: unknown): PromiseLike<unknown> | unknown;
}

/** Confirm the complete filename pair before either native artifact is committed. */
export async function saveHandoffArtifact(service: Readonly<HandoffSavePort>, request: Readonly<HandoffSaveRequest>): Promise<unknown> {
	if (!service.chooseSaveTarget) return service.saveFile(request);
	let suggestedName = request.suggestedName;
	for (;;) {
		request.signal.throwIfAborted();
		let target: unknown;
		try { target = await service.chooseSaveTarget({ ...request, suggestedName }); }
		catch (error) {
			request.signal.throwIfAborted();
			if (error instanceof Error && error.name === 'AbortError') return service.saveFile({ ...request, target: null });
			throw error;
		}
		if (target == null) return service.saveFile({ ...request, target: null });
		try {
			request.signal.throwIfAborted();
			const descriptor = typeof target === 'object' ? Object.getOwnPropertyDescriptor(target, 'name') : undefined;
			const name = descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
				? descriptor.value : suggestedName;
			let accepted = false;
			if (request.purpose === 'project-copy') {
				suggestedName = boundCrossProductHandoffArchiveFileName(name);
				accepted = suggestedName === name;
				if (accepted) crossProductHandoffReportSidecarFileName(name);
			} else accepted = name === request.suggestedName;
			if (!accepted) continue;
			return await service.saveFile({ ...request, target });
		} finally { await service.releaseSaveTarget?.(target); }
	}
}
