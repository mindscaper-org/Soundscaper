/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join } from 'node:path';
import { flipFuses as flipElectronFuses, FuseVersion, FuseV1Options, type FuseConfig } from '@electron/fuses';

export interface DesktopElectronFuseContextCurrentV1 {
	readonly electronPlatformName: string;
	readonly appOutDir: string;
	readonly packager: { readonly executableName: string; readonly appInfo: { readonly productFilename: string } };
}
export type DesktopElectronFuseWriterCurrentV1 = (path: string, options: FuseConfig) => Promise<unknown>;

/** Shared production fuse policy, applied before the platform code seal. */
export async function hardenDesktopElectronFusesCurrentV1(
	context: Readonly<DesktopElectronFuseContextCurrentV1>, flipFuses: DesktopElectronFuseWriterCurrentV1 = flipElectronFuses,
): Promise<void> {
	const extensions: Readonly<Record<string, string>> = { darwin: '.app', mas: '.app', win32: '.exe', linux: '' };
	const extension = extensions[context.electronPlatformName];
	if (extension === undefined) throw new Error(`Unsupported Electron fuse platform: ${context.electronPlatformName}`);
	const name = context.electronPlatformName === 'linux' ? context.packager.executableName : context.packager.appInfo.productFilename;
	if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,95}$/u.test(name)
		|| !isAbsolute(context.appOutDir) || typeof flipFuses !== 'function') throw new TypeError('Electron fuse context is invalid.');
	await flipFuses(join(context.appOutDir, `${name}${extension}`), {
		version: FuseVersion.V1,
		strictlyRequireAllFuses: true,
		[FuseV1Options.RunAsNode]: false,
		[FuseV1Options.EnableCookieEncryption]: true,
		[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
		[FuseV1Options.EnableNodeCliInspectArguments]: false,
		[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
		[FuseV1Options.OnlyLoadAppFromAsar]: true,
		// Stock Electron has a shared V8 snapshot; its browser-only snapshot is absent.
		[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
		[FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
		[FuseV1Options.WasmTrapHandlers]: true,
	});
}
