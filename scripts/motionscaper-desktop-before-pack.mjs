/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { nativeAddonPayloadTargetForPackagingContext } from './lib/native-addon-payload-manifest.mjs';
import { signVerifiedMotionMacStage } from './lib/motionscaper-mac-signing.ts';
import { verifyMotionscaperDesktopStage } from './lib/motionscaper-desktop-package.mjs';

export default async function verifyMotionscaperBeforePack(context, dependencies = {}) {
	await verifyMotionscaperDesktopStage(
		resolve(context.packager.projectDir, '.desktop-build'),
		nativeAddonPayloadTargetForPackagingContext(context),
	);
	await signVerifiedMotionMacStage(context, dependencies);
	return verifyMotionscaperDesktopStage(resolve(context.packager.projectDir, '.desktop-build'), nativeAddonPayloadTargetForPackagingContext(context));
}
