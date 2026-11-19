/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { canonicalizeNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as profile } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { requireExactRetimeClosure } from './helpers/framescaper-boost-closure.js';
import { createMediaContractHostFixture } from './helpers/framescaper-media-contract-host-fixture.js';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const host = createMediaContractHostFixture(resolve(import.meta.dirname, '..'));
test.after(() => host.cleanup());

test('V14 admits authenticated replay files and the exact live pair, with no mixed carriers', async (context) => {
	if (!requireExactRetimeClosure(context)) return;
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-v14-replay-host-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const executable = host.copyTo(join(directory, 'framescaper-media-host'));
	const project = createFramescaperProjectNativeMedia(profile, framescaperV20Options());
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		profile, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	assert.equal(plan.output.includeAudio, true);
	const planBytes = Buffer.from(canonicalizeNativeMediaPlan(plan));
	const planPath = join(directory, 'plan.json');
	const scratch = join(directory, 'scratch');
	const destination = join(directory, 'destination');
	await Promise.all([writeFile(planPath, planBytes), mkdir(scratch), mkdir(destination)]);
	const [carrier, audio] = await Promise.all([
		fileGrant(directory, 'carrier.frames', 'evaluated-rgba-frame-pack'),
		fileGrant(directory, 'audio.wav', 'staged-audio-mix'),
	]);
	const carrierStream = ['--source-stream', 'stdin', '--source-byte-length', '1', '--source-role', 'evaluated-rgba-frame-pack'];
	const audioStream = ['--source-stream-fd', '3', '--source-byte-length', '1', '--source-role', 'staged-audio-mix'];
	const run = (inputs: string[]) => spawnSync(executable, [
		'--operation', 'media-render', '--plan', planPath, '--plan-sha256', sha256(planBytes),
		...inputs, '--backend', 'native-cpu', '--maximum-output-bytes', '1048576', '--scratch', scratch,
		'--destination-root', destination, '--temporary-output', join(destination, 'out.mov'),
	], { encoding: 'utf8' });
	for (const inputs of [[...carrier, ...audio], [...carrierStream, ...audioStream]]) {
		const admitted = run(inputs);
		assert.equal(admitted.status, 78, admitted.stderr || admitted.stdout);
		assert.deepEqual(JSON.parse(admitted.stdout), {
			error: 'contract-build-has-no-ffmpeg', operation: 'media-render',
			subset: 'evaluated-rgba-frame-pack-v1', planVersion: 14,
		});
	}
	for (const inputs of [[...carrier, ...audioStream], [...carrierStream, ...audio]]) {
		const mixed = run(inputs);
		assert.equal(mixed.status, 64, mixed.stderr || mixed.stdout);
		assert.match(mixed.stderr, /V14.*audio.*grant/u);
	}
	const mismatched = run([...carrier, ...audio].map(argument => argument === carrier[3] ? '1'.repeat(64) : argument));
	assert.equal(mismatched.status, 65, mismatched.stderr || mismatched.stdout);
	assert.match(mismatched.stderr, /source.*digest|authenticate/u);
});

async function fileGrant(directory: string, name: string, role: string): Promise<string[]> {
	const path = join(directory, name);
	const bytes = Buffer.from(role);
	await writeFile(path, bytes);
	return ['--source', path, '--source-sha256', sha256(bytes), '--source-byte-length', String(bytes.byteLength), '--source-role', role];
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
