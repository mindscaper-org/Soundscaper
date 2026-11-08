/* SPDX-License-Identifier: AGPL-3.0-only */

import { createBrowserFileSaveService, type BrowserFileSaveServiceOptions,
	type BrowserFileSaveRequest } from '../common/editor/browser-file-save-service.ts';
import { capturePhotoBrowserDownloadOpportunityCurrentV1, type PhotoBrowserDownloadOpportunityScopeCurrentV1 } from './photo-browser-download-opportunity-current-v1.ts';

type BrowserSaveScope = NonNullable<BrowserFileSaveServiceOptions['scope']>;
export interface LightscaperFileSaveScopeCurrentV1 extends BrowserSaveScope, PhotoBrowserDownloadOpportunityScopeCurrentV1 {
	readonly lightscaperDesktop?: Readonly<{ readonly v1?: Readonly<{ readonly getEnvironment?: unknown }> }>;
}
export interface LightscaperFileSaveServiceOptionsCurrentV1 extends Omit<BrowserFileSaveServiceOptions, 'scope'> {
	readonly scope?: LightscaperFileSaveScopeCurrentV1;
}

/** Pin one delivery backend for the prepared target and its later publication.
 * Electron owns the native dialog for blob downloads; ordinary browsers retain
 * their activating-turn File System Access picker and staged stream writer.
 * Browser sidecars yield a visible opportunity before and after their anchor
 * request, outside the raster controller's irreversible image commit shield.
 * A hidden/refused opportunity before JSON becomes its retryable partial result;
 * after JSON, the known receipt survives. Electron's lifecycle stays separate. */
export function createLightscaperFileSaveServiceCurrentV1(options: LightscaperFileSaveServiceOptionsCurrentV1 = {}) {
	const scope = options.scope ?? (globalThis as LightscaperFileSaveScopeCurrentV1);
	const desktopDownload = typeof scope.lightscaperDesktop?.v1?.getEnvironment === 'function';
	const files = createBrowserFileSaveService({ ...options, scope });
	const opportunity = desktopDownload ? null : capturePhotoBrowserDownloadOpportunityCurrentV1(scope,
		options.document === undefined ? scope.document : options.document);
	const requestForDelivery = (request: BrowserFileSaveRequest): BrowserFileSaveRequest => desktopDownload
		? { ...request, useFileSystemAccess: false } : request;
	return Object.freeze({
		prepareSave: (request: BrowserFileSaveRequest = {}) => files.prepareSave(requestForDelivery(request)),
		saveFile: async (request: BrowserFileSaveRequest = {}) => {
			const name = request.target?.name ?? request.suggestedName;
			const sidecar = opportunity && request.purpose === 'media' && request.mimeType === 'application/json'
				&& request.target?.browserDownload === true && typeof request.target.createWritable !== 'function'
				&& typeof name === 'string' && name.endsWith('.lightscaper.json');
			if (sidecar) {
				const visible = await opportunity(request.signal); request.signal?.throwIfAborted();
				if (!visible) throw new Error('A visible presentation opportunity is required to download the Photo sidecar.');
			}
			const saved = await files.saveFile(requestForDelivery(request));
			if (sidecar && 'method' in saved && saved.method === 'download') await opportunity(request.signal);
			return saved;
		},
	});
}
