#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { verifyPublishedPagesArtifactIdentity } from './lib/pages-deploy-artifact-binding.mjs';
import { webBuildRouting } from './lib/product-web-routing.mjs';

const routing = webBuildRouting();
await verifyPublishedPagesArtifactIdentity({
	expectedArtifactPath: resolve('.wrangler/handbook-site/docs/index.html'),
	origin: routing.site.origin,
	publishedPath: routing.handbook.scope,
});
console.log(`Verified the published ${routing.productId} handbook matches the checked build.`);
