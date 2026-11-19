/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { analyzeCoverageSummary, formatCoverageScopes } from './coverage-gates.mjs';
import { normalizeDuplicateFunctionCoverage } from './coverage-function-normalization.mjs';

/**
 * Merge the recorded shards into one report and hand back its summary.
 *
 * The gate and the ratchet must measure the same thing, so both go through
 * here rather than each spawning c8 with its own idea of the reporters.
 *
 * @param {string} repositoryRoot
 * @param {string} temporaryDirectory
 */
export function reportCoverageSummary(repositoryRoot, temporaryDirectory) {
	const reportDirectory = resolve(repositoryRoot, 'coverage');
	const preparedDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-coverage-shards-'));
	try {
		// Complete source rebasing in a separate, sequential bounded process so
		// its parsed compacts are gone before c8 loads the complete union.
		const preparation = spawnSync(process.execPath, [
			'--max-old-space-size=3072',
			resolve(import.meta.dirname, '../prepare-coverage-shards.mjs'),
			repositoryRoot,
			resolve(repositoryRoot, temporaryDirectory),
			preparedDirectory,
		], { cwd: repositoryRoot, env: process.env, stdio: 'inherit' });
		assertProcessSucceeded(preparation, 'Coverage source preparation');
		// The synchronous merge is deterministic for the pre-compacted CI shards.
		// `--merge-async` has shifted branch counts with directory listing order.
		const result = spawnSync(resolve(repositoryRoot, 'node_modules/.bin/c8'), [
			'report',
			// Input addresses include source files and generated browser chunks.
			// Apply the unchanged include rules to their authenticated source owners.
			'--exclude-after-remap',
			`--temp-directory=${preparedDirectory}`,
			`--reports-dir=${reportDirectory}`,
			'--reporter=text-summary',
			'--reporter=lcov',
			'--reporter=json-summary',
			'--reporter=json',
		], { cwd: repositoryRoot, env: process.env, stdio: 'inherit' });

		assertProcessSucceeded(result, 'The coverage report');

		const summary = JSON.parse(readFileSync(resolve(reportDirectory, 'coverage-summary.json'), 'utf8'));
		const detailed = JSON.parse(readFileSync(resolve(reportDirectory, 'coverage-final.json'), 'utf8'));
		return normalizeDuplicateFunctionCoverage(summary, detailed);
	} finally {
		rmSync(preparedDirectory, { recursive: true, force: true });
	}
}

function assertProcessSucceeded(result, label) {
	if (result.error) throw result.error;
	if (result.signal) throw new Error(`${label} terminated with ${result.signal}.`);
	if (result.status !== 0) throw new Error(`${label} exited with status ${result.status ?? 1}.`);
}

export function runCoverageGate(repositoryRoot, temporaryDirectory) {
	const summary = reportCoverageSummary(repositoryRoot, temporaryDirectory);
	const analysis = analyzeCoverageSummary(summary, repositoryRoot);
	process.stdout.write(formatCoverageScopes(analysis.scopes));
	if (analysis.failures.length > 0) {
		process.stderr.write(`${analysis.failures.join('\n')}\n`);
	}
	return analysis.failures.length === 0;
}
