#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rebaseCoverageProfileSources } from './lib/coverage-profile-source-rebasing.mjs';

function main(argv) {
	if (argv.length !== 3) throw new Error('Usage: prepare-coverage-shards.mjs <repository-root> <recorded-shards> <fresh-output-directory>');
	const [repositoryRoot, recorded, destination] = argv.map(path => resolve(path));
	if (recorded === destination) throw new Error('Prepared coverage must not overwrite its recorded shards.');
	mkdirSync(destination, { recursive: true });
	if (readdirSync(destination).length !== 0) throw new Error('Prepared coverage needs an empty output directory.');
	let count = 0;
	// Parse and write one compact at a time in this bounded child. Keep the input
	// file names and iteration order; the c8 caller retains no parsed profiles.
	for (const entry of readdirSync(recorded, { withFileTypes: true })) {
		if (!entry.name.endsWith('.json')) continue;
		const input = resolve(recorded, entry.name);
		if (!statSync(input).isFile()) throw new Error(`A recorded coverage shard is not a file: ${entry.name}.`);
		const profile = JSON.parse(readFileSync(input, 'utf8'));
		const prepared = rebaseCoverageProfileSources(profile, repositoryRoot);
		writeFileSync(resolve(destination, entry.name), JSON.stringify(prepared), { flag: 'wx' });
		count++;
	}
	if (count === 0) throw new Error('No recorded coverage shards were available to prepare.');
	process.stdout.write(`Prepared source ownership for ${count} recorded coverage shard(s).\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
