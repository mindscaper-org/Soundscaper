/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';

import { DOWNLOAD_ENGLISH_COPY } from '../src/common/site/download-copy.ts';
import { runCli } from './i18n-ai/cli.mjs';

const directory = fileURLToPath(new URL('../src/common/site/download-translations/', import.meta.url));

try {
	await runCli(process.argv.slice(2), {
		directory,
		englishCopy: DOWNLOAD_ENGLISH_COPY,
		indexOptions: { jsonImportAttributes: true },
	});
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
