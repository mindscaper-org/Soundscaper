/* SPDX-License-Identifier: AGPL-3.0-only */

export function configureWindowsApplicationIdentity({ platform, windowsStore, appId, setAppUserModelId }: {
	platform: string; windowsStore: boolean | undefined; appId: string;
	setAppUserModelId: (identity: string) => void;
}): void {
	// Packaged Windows supplies the AUMID; an unpackaged product ID cannot replace it.
	if (platform === 'win32' && windowsStore !== true) setAppUserModelId(appId);
}

export async function checkDesktopDistributionUpdates<Result>({ windowsStore, manual, checkRelease, openExternal }: {
	windowsStore: boolean | undefined; manual: boolean;
	checkRelease: (options: { manual: boolean }) => Promise<Result>;
	openExternal: (url: string) => Promise<void>;
}): Promise<Result | { status: 'store-managed' }> {
	if (windowsStore !== true) return checkRelease({ manual });
	if (manual) await openExternal('ms-windows-store://downloadsandupdates');
	return { status: 'store-managed' };
}
