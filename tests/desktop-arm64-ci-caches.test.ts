/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

interface Step { name?: string; run?: string; uses?: string; with?: Record<string, unknown> }
interface Workflow { jobs: Record<string, { steps?: Step[] }> }
const { load } = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => Workflow };

test('Windows ARM64 build lanes reuse the same authenticated installed dependency policy', async () => {
	for (const [workflow, jobs] of [
		['desktop-preview', ['prepare-assistance-runtime-handoff', 'package', 'soundscaper-project-library-lease-matrix']],
		['soundscaper-professional-native-build', ['build']],
		['update-ai-assets', ['publish']],
		['soundscaper-stable-1', ['package']],
		['desktop-nightly-tests', ['package-with-tests']],
	] as const) {
		const parsed = load(await readFile(new URL(`../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8'));
		for (const id of jobs) {
			const steps = parsed.jobs[id]?.steps;
			assert.ok(steps, `${workflow}/${id} exists`);
			const cached = steps.filter(step => step.uses === './.github/actions/verified-node-dependencies');
			assert.equal(cached.length, 1, `${workflow}/${id} restores verified installed dependencies`);
			assert.equal(cached[0]?.with?.scope, 'desktop-native');
			assert.equal(steps.some(step => /\bnpm ci\b/u.test(step.run ?? '')), false);
		}
	}
});
