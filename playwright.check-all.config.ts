/* SPDX-License-Identifier: AGPL-3.0-only */

import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

import ordinary from './playwright.config.mjs';

if (process.env.SCAPE_CHECK_ALL_SERVERS !== '1') throw new Error('Run this configuration through npm run check-all, which owns the shared preview servers.');

export default defineConfig({
	...ordinary,
	// defineConfig concatenates webServer arrays across arguments; replace them here.
	webServer: [],
	reporter: [[resolve(import.meta.dirname, 'scripts/check-all-browser-reporter.ts')]],
});
