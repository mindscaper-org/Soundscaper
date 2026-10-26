/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

interface WorkflowStep {
	name?: string;
	if?: string;
	run?: string;
	uses?: string;
	with?: Record<string, unknown>;
	env?: Record<string, string>;
}

interface WorkflowJob {
	needs?: string | string[];
	if?: string;
	steps?: WorkflowStep[];
	with?: Record<string, unknown>;
	env?: Record<string, string>;
	strategy?: { matrix?: { target?: Record<string, string>[] } };
}

interface Workflow {
	on: { workflow_call?: { inputs?: Record<string, { required?: boolean; default?: unknown }> } };
	jobs: Record<string, WorkflowJob>;
}

const require = createRequire(import.meta.url);
const { load } = require('js-yaml') as { load: (source: string) => Workflow };
const handoffRoot = '${{ github.workspace }}/.native-build/assistance-runtime-handoff';
const archiveCache = '${{ github.workspace }}/.native-build/assistance-runtime-handoff-cache';

async function readWorkflow(name: string): Promise<Workflow> {
	return load(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
}

function getJob(workflow: Workflow, id: string): WorkflowJob {
	const job = workflow.jobs[id];
	assert.ok(job, `missing workflow job ${id}`);
	return job;
}

function dependencies(job: WorkflowJob): string[] {
	return typeof job.needs === 'string' ? [job.needs] : job.needs ?? [];
}

function artifactStep(job: WorkflowJob, action: 'upload' | 'download', name: string): WorkflowStep {
	const step = job.steps?.find(candidate => candidate.uses?.startsWith(`actions/${action}-artifact@`)
		&& typeof candidate.with?.name === 'string' && candidate.with.name.includes(name));
	assert.ok(step, `missing ${action} of ${name}`);
	return step;
}

function preparationStep(job: WorkflowJob): WorkflowStep {
	const step = job.steps?.find(candidate => /(?:desktop:prepare|scripts\/desktop-prepare\.mjs)/u.test(candidate.run ?? ''));
	assert.ok(step, 'the packaged consumer must prepare its desktop runtime');
	return step;
}

function assertOfflineInputs(job: WorkflowJob, metadataName: string): void {
	const metadata = artifactStep(job, 'download', metadataName);
	const archives = artifactStep(job, 'download', 'assistance-runtime-archives');
	assert.equal(metadata.with?.path, handoffRoot);
	assert.equal(archives.with?.path, archiveCache,
		'early consumers need the exact local archive cache before anything is publicly published');
	const prepare = preparationStep(job);
	const steps = job.steps ?? [];
	assert.ok(steps.indexOf(metadata) < steps.indexOf(prepare));
	assert.ok(steps.indexOf(archives) < steps.indexOf(prepare));
	assert.equal({ ...job.env, ...prepare.env }.SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT, handoffRoot);
}

test('preview builds each target AI closure once before the quality gates and retains offline inputs', async () => {
	const workflow = await readWorkflow('desktop-preview');
	const producer = getJob(workflow, 'prepare-assistance-runtime-handoff');
	assert.deepEqual(dependencies(producer), [], 'native runtime compilation must overlap the quality gate');
	const targets = producer.strategy?.matrix?.target;
	assert.ok(targets);
	assert.deepEqual(targets.map(target => `${target.platform}-${target.arch}`).sort(),
		['linux-arm64', 'linux-x64', 'mac-arm64', 'win-arm64', 'win-x64']);
	const preparers = producer.steps?.filter(step => /scripts\/desktop-prepare\.mjs/u.test(step.run ?? ''));
	assert.ok(preparers);
	assert.equal(preparers.length, 1);
	assert.equal(preparers[0]?.env?.SOUNDSCAPER_SOURCE_REVISION, '${{ github.sha }}');
	const metadata = artifactStep(producer, 'upload', 'assistance-runtime-handoff');
	const archives = artifactStep(producer, 'upload', 'assistance-runtime-archives');
	assert.equal(metadata.with?.['if-no-files-found'], 'error');
	assert.equal(archives.with?.['if-no-files-found'], 'error');
	assert.equal(archives.with?.['compression-level'], 0, 'runtime archives are already compressed');
	assert.ok(producer.steps?.every(step => !JSON.stringify(step.env ?? {}).includes('secrets.R2_MODELS_')),
		'the early build does not receive publication credentials');
});

test('publication waits for quality and tests and publishes the existing authenticated handoff', async () => {
	const workflow = await readWorkflow('desktop-preview');
	const publisher = getJob(workflow, 'publish-assistance-runtime-handoff');
	assert.deepEqual(dependencies(publisher).sort(), ['prepare-assistance-runtime-handoff', 'quality', 'tests']);
	assert.doesNotMatch(publisher.if ?? '', /always\(|failure\(|cancelled\(/u,
		'failed quality checks must prevent publication');
	artifactStep(publisher, 'download', 'assistance-runtime-handoff');
	artifactStep(publisher, 'download', 'assistance-runtime-archives');
	const commands = publisher.steps?.map(step => step.run ?? '').join('\n') ?? '';
	assert.match(commands, /scripts\/publish-assistance-runtime-handoff\.ts/u);
	assert.doesNotMatch(commands, /desktop-prepare|desktop:prepare|cmake|setup-uv/u,
		'publication must consume build outputs without a second runtime build');
	const publishing = publisher.steps?.find(step => step.run?.includes('scripts/publish-assistance-runtime-handoff.ts'));
	assert.equal({ ...publisher.env, ...publishing?.env }.SOUNDSCAPER_SOURCE_REVISION, '${{ github.sha }}',
		'the publisher authenticates the handoff against this exact workflow revision');
	assert.equal({ ...publisher.env, ...publishing?.env }.R2_MODELS_ACCESS_KEY_ID,
		'${{ secrets.R2_MODELS_ACCESS_KEY_ID }}');
});

test('professional harnesses use the same-run handoff or a committed snapshot without rebuilding engines', async () => {
	const preview = await readWorkflow('desktop-preview');
	const caller = getJob(preview, 'professional-native-build');
	assert.ok(dependencies(caller).includes('prepare-assistance-runtime-handoff'));
	assert.equal(caller.with?.['assistance-runtime-handoff-artifact-prefix'], 'assistance-runtime-handoff');
	const reusable = await readWorkflow('soundscaper-professional-native-build');
	const input = reusable.on.workflow_call?.inputs?.['assistance-runtime-handoff-artifact-prefix'];
	assert.ok(input);
	assert.notEqual(input.required, true, 'standalone builds still support the committed test snapshot');
	assert.equal(input.default, '');
	const build = getJob(reusable, 'build');
	assertOfflineInputs(build, 'inputs.assistance-runtime-handoff-artifact-prefix');
	const metadata = artifactStep(build, 'download', 'inputs.assistance-runtime-handoff-artifact-prefix');
	const archives = artifactStep(build, 'download', 'assistance-runtime-archives');
	assert.match(metadata.if ?? '', /inputs\.assistance-runtime-handoff-artifact-prefix/u);
	assert.equal(archives.if, metadata.if, 'metadata and archives are selected together');
	const snapshot = build.steps?.find(step => step.run?.includes('scripts/stage-desktop-test-runtime-snapshot.mjs'));
	assert.ok(snapshot, 'standalone self-tests reuse the committed runtime snapshot');
	assert.match(snapshot.if ?? '', /inputs\.assistance-runtime-handoff-artifact-prefix\s*==\s*''/u);
	assert.notEqual(snapshot.if, metadata.if, 'fresh runtime authority must never use a stale snapshot fallback');
	assert.ok((build.steps ?? []).indexOf(snapshot) < (build.steps ?? []).indexOf(preparationStep(build)));
	const prepare = preparationStep(build);
	assert.equal({ ...build.env, ...prepare.env }.SOUNDSCAPER_SOURCE_REVISION, '${{ github.sha }}');
	assert.equal({ ...build.env, ...prepare.env }.SOUNDSCAPER_TEST_RUNTIME_SNAPSHOT, undefined,
		'only the conditional snapshot stage may select an older pinned runtime revision');
});

test('both packaged lease products reuse offline same-run runtime authority before publication', async () => {
	const workflow = await readWorkflow('desktop-preview');
	const lease = getJob(workflow, 'soundscaper-project-library-lease-matrix');
	assert.ok(dependencies(lease).includes('prepare-assistance-runtime-handoff'));
	assert.ok(!dependencies(lease).includes('publish-assistance-runtime-handoff'),
		'package self-tests must not wait for publication of already built runtime bytes');
	assertOfflineInputs(lease, 'assistance-runtime-handoff');
	const prepare = preparationStep(lease);
	assert.equal({ ...lease.env, ...prepare.env }.SOUNDSCAPER_SOURCE_REVISION, '${{ github.sha }}');
	assert.match(prepare.run ?? '', /for product in soundscaper framescaper/u);
	assert.equal({ ...lease.env, ...prepare.env }.SOUNDSCAPER_TEST_RUNTIME_SNAPSHOT, undefined,
		'release lease tests must authenticate current-source runtimes');
});
