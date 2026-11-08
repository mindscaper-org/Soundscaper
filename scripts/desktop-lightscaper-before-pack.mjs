/* SPDX-License-Identifier: AGPL-3.0-only */

import { verifyLightscaperBuilderStageCurrentV1 } from './lib/desktop-lightscaper-package-current-v1.ts';

/** Lightscaper currently mounts managed Web Core plus the exact pinned RAW closure.
 * @param {import('./lib/desktop-lightscaper-package-current-v1.ts').LightscaperBuilderContextCurrentV1} context */
export default async function verifyLightscaperBeforePack(context) {
	await verifyLightscaperBuilderStageCurrentV1(context);
}
