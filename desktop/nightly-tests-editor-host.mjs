/* SPDX-License-Identifier: AGPL-3.0-only */

import { accessSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { NIGHTLY_ASSISTANCE_HOST_FLAG, resolveNightlyAssistanceHostPlan } from './nightly-tests-assistance-host.mjs';

export const NIGHTLY_EDITOR_HOST_FLAG = '--soundscaper-nightly-editor-host';

/** Diagnostic-launcher only: boot the shipped editor, rather than a bridge-only document. */
export function startNightlyEditorHost({ app, dialog }, dependencies = {}) {
	const argv = dependencies.argv ?? process.argv;
	const environment = dependencies.environment ?? process.env;
	if (!argv.includes(NIGHTLY_EDITOR_HOST_FLAG)) throw new Error('The editor host requires its explicit nightly flag.');
	const plan = resolveNightlyAssistanceHostPlan({
		argv: argv.map(value => value === NIGHTLY_EDITOR_HOST_FLAG ? NIGHTLY_ASSISTANCE_HOST_FLAG : value),
		environment, platform: dependencies.platform ?? process.platform, arch: dependencies.arch ?? process.arch,
	});
	const fileSystem = dependencies.fileSystem ?? { accessSync, mkdirSync, readFileSync, writeFileSync };
	fileSystem.accessSync(plan.preload);
	fileSystem.accessSync(plan.icon);
	const metadata = JSON.parse(fileSystem.readFileSync(join(plan.productApp, 'desktop/product.json'), 'utf8'));
	if (metadata.schemaVersion !== 1 || metadata.id !== plan.productId
		|| typeof metadata.applicationVersion !== 'string' || !metadata.applicationVersion) {
		throw new Error('The nightly editor package metadata is invalid.');
	}
	fileSystem.mkdirSync(plan.profile, { recursive: true, mode: 0o700 });
	const appData = join(plan.profile, 'application-data');
	fileSystem.mkdirSync(appData, { recursive: true, mode: 0o700 });
	fileSystem.writeFileSync(join(plan.profile, 'desktop-settings.json'), JSON.stringify({
		schemaVersion: 1, locale: 'en', updatesEnabled: false,
		modelsDirectory: plan.modelCache, nativePluginDiscoveryEnabled: false,
	}));
	app.setPath('userData', plan.profile);
	app.setPath('appData', appData);
	app.setAppPath(plan.productApp);
	// Direct checkout runs use Electron's default app as launcher too. The loaded
	// editor is still the staged package and must resolve its packaged resources.
	if (!app.isPackaged) Object.defineProperty(app, 'isPackaged', { value: true });
	// The launcher supplies Electron; all editor code, resources and helpers come
	// from the authenticated product archive/resources identified by the fixture.
	app.getVersion = () => metadata.applicationVersion;
	(dependencies.setResourcesPath ?? (value => { Object.defineProperty(process, 'resourcesPath', { value }); }))(
		resolve(dirname(plan.icon), '../..'),
	);
	dialog.showMessageBox = async (...args) => {
		if (args.at(-1)?.title !== 'Local Assistance consent') throw new Error('Unexpected nightly editor native dialog.');
		return { response: 0, checkboxChecked: false };
	};
	dialog.showOpenDialog = async () => { throw new Error('Unexpected nightly editor native file picker.'); };
	// This import MUST be synchronous. Electron does not postpone readiness for a
	// dynamic import; the production main registers schemes and sandbox policy.
	(dependencies.loadMain ?? createRequire(import.meta.url))(join(plan.productApp, 'desktop/main.mjs'));
	return plan;
}
