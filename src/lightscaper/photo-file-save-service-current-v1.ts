/* SPDX-License-Identifier: AGPL-3.0-only */

import { createBrowserFileSaveService, type BrowserFileSaveServiceOptions,
	type BrowserFileSaveRequest } from '../common/editor/browser-file-save-service.ts';

type BrowserSaveScope = NonNullable<BrowserFileSaveServiceOptions['scope']>;
export interface LightscaperFileSaveScopeCurrentV1 extends BrowserSaveScope {
	readonly lightscaperDesktop?: Readonly<{ readonly v1?: Readonly<{ readonly getEnvironment?: unknown }> }>;
}
export interface LightscaperFileSaveServiceOptionsCurrentV1 extends Omit<BrowserFileSaveServiceOptions, 'scope'> {
	readonly scope?: LightscaperFileSaveScopeCurrentV1;
}

/** Pin one delivery backend for the prepared target and its later publication.
 * Electron owns the native dialog for blob downloads; ordinary browsers retain
 * their activating-turn File System Access picker and staged stream writer. */
export function createLightscaperFileSaveServiceCurrentV1(options: LightscaperFileSaveServiceOptionsCurrentV1 = {}) {
	const scope = options.scope ?? (globalThis as LightscaperFileSaveScopeCurrentV1);
	const desktopDownload = typeof scope.lightscaperDesktop?.v1?.getEnvironment === 'function';
	const files = createBrowserFileSaveService({ ...options, scope });
	const requestForDelivery = (request: BrowserFileSaveRequest): BrowserFileSaveRequest => desktopDownload
		? { ...request, useFileSystemAccess: false } : request;
	return Object.freeze({
		prepareSave: (request: BrowserFileSaveRequest = {}) => files.prepareSave(requestForDelivery(request)),
		saveFile: (request: BrowserFileSaveRequest = {}) => files.saveFile(requestForDelivery(request)),
	});
}
