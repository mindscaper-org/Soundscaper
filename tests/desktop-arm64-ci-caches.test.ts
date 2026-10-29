/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

interface Step { name?: string; id?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown> }
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

test('AI producers prepare verified Kokoro bundles before runtime staging and replace damaged cache entries', async () => {
	for (const [workflow, id] of [['desktop-preview', 'prepare-assistance-runtime-handoff'], ['update-ai-assets', 'publish']]) {
		const parsed = load(await readFile(new URL(`../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8'));
		const steps = parsed.jobs[id]?.steps ?? [];
		const uv = steps.findIndex(step => step.uses?.startsWith('astral-sh/setup-uv@'));
		const cache = steps.findIndex(step => step.uses === './.github/actions/verified-kokoro-g2p');
		assert.ok(uv >= 0 && cache > uv, `${workflow} configures uv before restoring or building Kokoro`);
		assert.equal(steps[cache]?.with?.target, '${{ matrix.target.platform }}-${{ matrix.target.arch }}');
	}
	const action = load(await readFile(new URL('../.github/actions/verified-kokoro-g2p/action.yml', import.meta.url), 'utf8')) as unknown as {
		runs: { steps: Step[] };
	};
	const verification = action.runs.steps.find(step => step.id === 'bundle');
	assert.ok(verification);
	assert.equal(verification?.run, 'node scripts/ci-kokoro-g2p-cache.mjs prepare');
	assert.equal(verification.if, undefined, 'even an exact cache hit must reverify the bundle');
	const saving = action.runs.steps.find(step => step.uses?.startsWith('actions/cache/save@'));
	assert.equal(saving?.if, "steps.bundle.outputs.reused != 'true'");
	assert.match(String(saving?.with?.key), /github\.run_id/u, 'a damaged restore can be replaced under a fresh key');
});
