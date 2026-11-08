/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join } from 'node:path';
import type { BrowserWindowConstructorOptions } from 'electron';
import { LIGHTSCAPER_SHELL_ORIGIN_CURRENT_V1, LIGHTSCAPER_SHELL_PARTITION_CURRENT_V1 } from './lightscaper-shell-contract-current-v1.ts';

/** The photo surface has native OS controls until it explicitly adopts custom
 * window chrome. Its persistent partition owns browser IndexedDB and OPFS. */
export function lightscaperBrowserWindowOptionsCurrentV1({ preloadPath, rendererRoot, packaged }: Readonly<{
	preloadPath: string; rendererRoot: string; packaged: boolean;
}>): Readonly<BrowserWindowConstructorOptions> {
	if (!isAbsolute(preloadPath) || !isAbsolute(rendererRoot) || preloadPath.includes('\0') || rendererRoot.includes('\0')) {
		throw new TypeError('Lightscaper window resources must use absolute paths.');
	}
	return Object.freeze({
		title: 'Lightscaper', width: 1440, height: 900, minWidth: 400, minHeight: 600,
		show: false, frame: true, titleBarStyle: 'default', autoHideMenuBar: true,
		backgroundColor: '#14100d', icon: join(rendererRoot, 'offline-icons/lightscaper-512.png'),
		webPreferences: Object.freeze({
			preload: preloadPath, partition: LIGHTSCAPER_SHELL_PARTITION_CURRENT_V1,
			nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
			contextIsolation: true, sandbox: true, webSecurity: true,
			allowRunningInsecureContent: false, webviewTag: false, devTools: !packaged,
		}),
	});
}
export function isLightscaperBlobDownloadCurrentV1(url: string, initiatorOrigin: string): boolean {
	return initiatorOrigin === LIGHTSCAPER_SHELL_ORIGIN_CURRENT_V1
		&& /^blob:lightscaper-app:\/\/bundle\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(url);
}
