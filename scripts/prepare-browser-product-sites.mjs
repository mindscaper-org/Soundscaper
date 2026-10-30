#!/usr/bin/env node

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ordinaryBrowserProductSitePlan,
	prepareOrdinaryBrowserProductSites,
	verifyBrowserProductSite,
} from './lib/browser-product-test-sites.mjs';

// Named imports are deliberately explicit: the Playwright configuration test
// holds this entry point to authenticating the downloaded artifact before it
// becomes a browser-test server root.
void verifyBrowserProductSite;

// Module checks may request one product; the default plan still authenticates
// both ordinary CI products before either preview starts.
await prepareOrdinaryBrowserProductSites(ordinaryBrowserProductSitePlan(), {
	reusePrepared: process.env.SCAPE_BROWSER_PRODUCTS_PREPARED === '1',
});
