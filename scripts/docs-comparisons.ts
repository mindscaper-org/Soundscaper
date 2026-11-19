#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { generateComparisonDocuments } from './lib/handbook-comparisons.ts';

const arguments_ = process.argv.slice(2);
try {
	if (arguments_.some(argument => argument !== '--check')) throw new Error('Only --check is supported.');
	const check = arguments_.includes('--check');
	const { stale, documentCount } = await generateComparisonDocuments(resolve(import.meta.dirname, '..'), { write: !check });
	if (check && stale.length) {
		throw new Error(`Stale comparison pages: ${stale.join(', ')}. Run npm run docs:generate.`);
	}
	console.log(`Comparison pages ${stale.length ? 'generated' : 'current'} (${documentCount} documents).`);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
