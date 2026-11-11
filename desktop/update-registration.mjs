/* SPDX-License-Identifier: AGPL-3.0-only */
import { join } from 'node:path';
import { ReleaseChecker } from './project-library-runtime/desktop/update-check.js';
import { compareVersions, releaseTagForVersion } from './project-library-runtime/desktop/release-version.js';
import { DesktopUpdateInstallation, replaceUpdateAppImage, selectUpdateInstaller } from './project-library-runtime/desktop/update-installation.js';
import { DesktopUpdateService } from './project-library-runtime/desktop/update-service.js';
import { UPDATE_PREFERENCES_CHANNEL, updatePreferences } from './project-library-runtime/desktop/update-preferences.js';

export function createDesktopUpdates({ app, appName, tagPrefix, storage, settings, shell, dialog, windowFor, handle,
	platform = process.platform, arch = process.arch, windowsStore = process.windowsStore, appImage = process.env.APPIMAGE, fetchImpl = fetch }) {
	const available = !storage.portable && windowsStore !== true;
	handle(UPDATE_PREFERENCES_CHANNEL, (_event, enabled) => updatePreferences(settings, available, enabled));
	const checker = new ReleaseChecker({ currentVersion: app.getVersion(), settings, tagPrefix, fetchImpl });
	const target = { productName: appName, tagPrefix, platform, arch, appImage: !!appImage };
	const installation = new DesktopUpdateInstallation({
		root: join(storage.stateRoot, 'updates'), currentVersion: app.getVersion(),
		fetchImpl,
		isNewer: (candidate, current) => compareVersions(candidate, current) > 0,
		accepts: (installer) => {
			const expected = selectUpdateInstaller({ tag_name: releaseTagForVersion(installer.version, tagPrefix), assets: [{
				name: installer.name, size: installer.size, digest: `sha256:${installer.sha256}`, browser_download_url: installer.url,
			}] }, { ...target, version: installer.version });
			return expected.name === installer.name;
		},
		openInstaller: async (path) => {
			if (target.appImage) {
				await replaceUpdateAppImage(path, appImage);
				app.relaunch({ execPath: appImage });
				app.quit();
			} else {
				const error = await shell.openPath(path);
				if (error) throw new Error(error);
			}
		},
	});
	return new DesktopUpdateService({
		appName, portable: storage.portable, windowsStore,
		checkRelease: (options) => checker.check(options), openExternal: (url) => shell.openExternal(url),
		showMessage: (options) => {
			const window = windowFor();
			return window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : Promise.resolve({ response: 2 });
		},
		install: async (when) => {
			const installer = selectUpdateInstaller(checker.availableRelease, { ...target, version: checker.availableVersion });
			await installation.install(installer, when);
		},
		installPending: () => installation.installPending(),
	});
}
