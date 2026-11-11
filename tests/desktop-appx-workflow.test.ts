/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

interface Step { name?: string; if?: string; run?: string; env?: Record<string, string>; with?: Record<string, string> }
interface Workflow { on: { workflow_dispatch: { inputs: { appx: { default: string; options: string[] } } } };
	jobs: { package: { strategy: { matrix: { target: { platform: string; arch: string }[] } }; steps: Step[] } } }
const { load } = createRequire(import.meta.url)('js-yaml') as { load: (source: string) => Workflow };

test('AppX CI is opt-in, reuses native Windows matrix inputs and uploads evidence separately', async () => {
	const workflow = load(await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8'));
	assert.equal(workflow.on.workflow_dispatch.inputs.appx.default, 'none');
	assert.deepEqual(workflow.on.workflow_dispatch.inputs.appx.options, ['none', 'development', 'store']);
	const job = workflow.jobs.package;
	assert.deepEqual(job.strategy.matrix.target.filter(target => target.platform === 'win').map(target => target.arch), ['x64', 'arm64']);
	const build = job.steps.find(step => step.name === 'Package optional Windows AppX');
	const upload = job.steps.find(step => step.name === 'Upload Windows AppX feasibility artifacts');
	assert.ok(build);
	assert.ok(upload);
	assert.match(build.if ?? '', /workflow_dispatch/u);
	assert.match(build.if ?? '', /inputs\.appx != 'none'/u);
	assert.match(build.if ?? '', /matrix\.target\.platform == 'win'/u);
	assert.equal(upload.if, build.if);
	assert.match(build.run ?? '', /--prepared --arch=\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(build.env?.SCAPE_APPX_IDENTITY_NAME ?? '', /vars\[matrix\.product.*'SOUNDSCAPER_APPX_IDENTITY_NAME'.*'FRAMESCAPER_APPX_IDENTITY_NAME'\]/u);
	assert.match(upload.with?.path ?? '', /release\/appx\/\*\.appx/u);
	assert.match(upload.with?.path ?? '', /release\/appx\/\*\.json/u);
	assert.equal(upload.with?.['if-no-files-found'], 'error');
});
