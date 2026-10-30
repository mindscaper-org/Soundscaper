#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Required checks must not become green because a failed dependency skipped work. */
export function assertModuleCIResults(results) {
	if (!results || typeof results !== 'object' || Array.isArray(results) || Object.keys(results).length === 0) {
		throw new Error('The Quality aggregate requires explicit prerequisite results.');
	}
	for (const id of ['build', 'tests', 'native-platform-compile', 'browser', 'firefox', 'lint', 'typecheck', 'audits']) {
		if (results[id]?.result !== 'success') throw new Error(`Required Quality job ${id} did not succeed (${results[id]?.result ?? 'missing'}).`);
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	assertModuleCIResults(JSON.parse(process.env.SCAPE_QUALITY_RESULTS ?? 'null'));
}
