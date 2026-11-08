/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

interface Step { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string> }
interface Job { uses?: string; needs?: string | string[]; if?: string; 'runs-on'?: string; steps?: Step[];
	strategy?: { matrix: Record<string, unknown> }; with?: Record<string, string> }
const { load } = createRequire(import.meta.url)('js-yaml') as { load: (source: string) => { jobs: Record<string, Job> } };
const reusable = './.github/workflows/desktop-assistance-runtimes.yml';

async function workflow(name: string) {
	return load(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
}

test('Windows ARM Whisper and llama compile on independent native runners before runtime assembly', async () => {
	const { jobs } = await workflow('desktop-assistance-runtimes');
	const engines = jobs['arm64-engines'];
	assert.ok(engines);
	assert.equal(engines['runs-on'], 'windows-11-arm');
	assert.equal(engines.needs, undefined, 'both engine builds start without an assembly dependency');
	assert.deepEqual(engines.strategy?.matrix.family, ['whisper-cpp', 'llama-cpp']);
	assert.match(engines.if ?? '', /platform.*win.*arch.*arm64/u);
	const steps = engines.steps ?? [];
	assert.ok(steps.findIndex(step => step.uses === './.github/actions/setup-native-tooling')
		< steps.findIndex(step => step.uses === './.github/actions/verified-node-dependencies'));
	assert.equal(steps.find(step => step.uses?.startsWith('actions/setup-node@'))?.with?.architecture, 'arm64');
	const build = steps.find(step => step.run?.includes('scripts/build-assistance-engine-part.ts'));
	assert.ok(build);
	assert.equal(build.env?.SOUNDSCAPER_SOURCE_REVISION, '${{ github.sha }}');
	const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
	assert.equal(upload?.with?.['if-no-files-found'], 'error');
	assert.equal(upload?.with?.['include-hidden-files'], true);
	const prepare = jobs.prepare;
	assert.ok(prepare);
	assert.equal(prepare.needs, 'arm64-engines');
	assert.match(prepare.if ?? '', /!cancelled\(\)/u);
	assert.match(prepare.if ?? '', /result == 'success'.*result == 'skipped'/u,
		'other targets proceed while failed engine builds prevent ARM assembly');
	const staging = prepare.steps?.find(step => step.run === 'node scripts/prepare-assistance-runtimes.mjs');
	assert.ok(staging?.env?.SOUNDSCAPER_ASSISTANCE_ENGINE_PARTS_ROOT);
	for (const family of ['whisper-cpp', 'llama-cpp']) {
		const download = prepare.steps?.find(step => step.with?.name === `assistance-engine-${family}-win-arm64`);
		assert.ok(download);
		assert.ok((prepare.steps ?? []).indexOf(download) < (prepare.steps ?? []).indexOf(staging));
		assert.match(download.if ?? '', /platform.*win.*arch.*arm64/u);
		assert.ok(String(download.with?.path).endsWith(`/assistance-engine-parts/${family}`));
	}
});

test('preview and manual AI updates use the same parallel-capable runtime producer', async () => {
	const preview = await workflow('desktop-preview');
	const producer = preview.jobs['prepare-assistance-runtime-handoff'];
	assert.equal(producer?.uses, reusable);
	assert.equal(producer.needs, undefined, 'native builds overlap the quality gate');
	assert.equal(producer.with?.target, '${{ toJSON(matrix.target) }}');
	const assets = await workflow('update-ai-assets');
	assert.equal(assets.jobs.prepare?.uses, reusable);
	assert.equal(assets.jobs.prepare?.with?.['handoff-artifact-prefix'], 'prepared-assistance-runtime-handoff');
	const publish = assets.jobs.publish;
	assert.ok(publish);
	assert.ok([publish.needs].flat().includes('prepare'));
	const stage = publish.steps?.find(step => step.run === 'node scripts/prepare-assistance-runtimes.mjs');
	assert.ok(stage?.env?.SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT,
		'publication imports the prepared authority instead of recompiling engines');
});
