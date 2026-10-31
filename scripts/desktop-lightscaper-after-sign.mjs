/* SPDX-License-Identifier: AGPL-3.0-only */
import verifySignature from './desktop-after-sign.mjs';
import { lightscaperBuilderBuildRootCurrentV1, lightscaperBuilderResourcesRootCurrentV1, lightscaperBuilderTargetCurrentV1, verifyDesktopLightscaperPackageReceiptCurrentV1 } from './lib/desktop-lightscaper-package-current-v1.ts';
/** Recheck FINAL nested-code bytes after platform signing, before artifact creation.
 * @param {import('./lib/desktop-lightscaper-package-current-v1.ts').LightscaperBuilderContextCurrentV1} context */
export default async function verifyLightscaperAfterSign(context) {
 await verifySignature(context);
 await verifyDesktopLightscaperPackageReceiptCurrentV1({ repositoryRoot: context.packager.projectDir, buildRoot: lightscaperBuilderBuildRootCurrentV1(context), resourcesRoot: lightscaperBuilderResourcesRootCurrentV1(context), target: lightscaperBuilderTargetCurrentV1(context) });
}
