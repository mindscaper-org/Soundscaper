/* SPDX-License-Identifier: AGPL-3.0-only */

import { hardenDesktopElectronFusesCurrentV1 } from './lib/desktop-electron-fuses-current-v1.ts';
import { verifyPackagedElectronAlternateFfmpeg } from './lib/electron-alternate-ffmpeg.mjs';
import {
	lightscaperBuilderBuildRootCurrentV1, lightscaperBuilderResourcesRootCurrentV1, verifyDesktopLightscaperPackagedCurrentV1,
	verifyLightscaperBuilderStageCurrentV1, writeDesktopLightscaperPackageReceiptCurrentV1,
} from './lib/desktop-lightscaper-package-current-v1.ts';

/** Owned resources and Electron's alternate media library authenticate before fuses and platform signing.
 * @param {import('./lib/desktop-lightscaper-package-current-v1.ts').LightscaperBuilderContextCurrentV1} context
 * @param {{ verifyElectronAlternateFfmpeg?: (context: import('./lib/desktop-lightscaper-package-current-v1.ts').LightscaperBuilderContextCurrentV1) => Promise<unknown>, flipFuses?: import('./lib/desktop-electron-fuses-current-v1.ts').DesktopElectronFuseWriterCurrentV1 }} dependencies */
export default async function hardenLightscaperAfterPack(context, dependencies = {}) {
	const stage = await verifyLightscaperBuilderStageCurrentV1(context);
	const repositoryRoot = context.packager.projectDir;
	const resourcesRoot = lightscaperBuilderResourcesRootCurrentV1(context);
	const receipt = await verifyDesktopLightscaperPackagedCurrentV1({ repositoryRoot,
		buildRoot: lightscaperBuilderBuildRootCurrentV1(context), resourcesRoot, target: stage.target });
	await (dependencies.verifyElectronAlternateFfmpeg ?? verifyPackagedElectronAlternateFfmpeg)(context);
	await hardenDesktopElectronFusesCurrentV1(context, dependencies.flipFuses);
	await writeDesktopLightscaperPackageReceiptCurrentV1(resourcesRoot, receipt);
}
