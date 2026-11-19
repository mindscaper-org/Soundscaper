/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isMainThread } from 'node:worker_threads';

import type { QualifiedNodeManifest } from './lib/qualified-node-artifacts.ts';
import type {} from './lib/qualified-node-capture.ts';

const manifestPath = process.env.SCAPE_QUALIFIED_NODE_MANIFEST;
const outputRoot = process.env.SCAPE_QUALIFIED_NODE_OUTPUT;
// The existing runner preloads this after tsx/style hooks. Unselected children
// do not load esbuild, attach Inspector, or install a production source hook.
if (manifestPath && outputRoot && isMainThread && process.env.NODE_TEST_CONTEXT === 'child-v8') {
	const repositoryRoot = resolve(process.cwd());
	const testPath = process.argv[1] ? relative(repositoryRoot, resolve(process.argv[1])).replaceAll('\\', '/') : undefined;
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as QualifiedNodeManifest;
	if (manifest.selectedTests.some(test => test.path === testPath)) {
		const { startQualifiedNodeCapture } = await import('./lib/qualified-node-capture.ts');
		const capture = await startQualifiedNodeCapture({ manifestPath, outputRoot, repositoryRoot });
		if (capture.active) process.once('beforeExit', () => {
			void capture.finish().catch((error: unknown) => {
				console.error(error);
				process.exitCode = 1;
			});
		});
	}
}
