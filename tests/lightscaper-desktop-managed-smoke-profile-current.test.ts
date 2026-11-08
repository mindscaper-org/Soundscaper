/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { createLightscaperManagedSmokeHooksCurrentV1 as create } from '../desktop/lightscaper-managed-smoke-main-current-v1.ts';
import { createLightscaperAssociationProfileCurrentV1 } from '../scripts/lib/lightscaper-desktop-association-profile-current-v1.ts';

const NONCE = 'a'.repeat(32), REVISION = 'b'.repeat(40);
const OPTIONS = { concurrency: false, timeout: 10_000 } as const;
async function fixture(context: TestContext, registered: boolean, run: (value: Awaited<ReturnType<typeof prepare>>) => Promise<void>) {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-smoke-profile-policy-')));
	// No browser is started by these factory tests. Own its otherwise180s watchdog locally.
	context.mock.timers.enable({ apis: ['setTimeout'] });
	try { await run(await prepare(root, registered)); }
	finally { context.mock.timers.reset(); await rm(root, { recursive: true, force: true }); }
}
async function prepare(root: string, registered: boolean) {
	const profilePath = join(root, registered ? 'default-profile' : 'profile');
	if (registered) await createLightscaperAssociationProfileCurrentV1({ ownerRoot: root, profilePath, nonce: NONCE, sourceRevision: REVISION });
	else await mkdir(profilePath, { mode: 0o700 });
	function file(name: string, mimeType: string, body: readonly number[]) {
		const bytes = Buffer.from(body); return { name, mimeType, base64: bytes.toString('base64'), byteLength: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex') };
	}
	const plan = { schemaVersion: 1, nonce: NONCE, stage: 1, profilePath,
		...(registered ? { registeredAssociation: { schemaVersion: 1, ownerNonce: NONCE, sourceRevision: REVISION } } : {}),
		renderer: { nonce: NONCE, stage: 1, locale: 'en', backend: 'web', scenario: 'managed',
			fixtures: [file('Owned raster.png', 'image/png', [1, 2, 3]), file('Owned Bayer.dng', 'image/x-adobe-dng', [4, 5, 6])],
			archive: null, expectedFingerprint: null, expectedNamespace: null, expectedPhotoIds: null, backupSuggestedName: 'Owned.liscape' } };
	const planPath = join(root, `${NONCE}.stage-1.json`); await writeFile(planPath, JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
	const relocated: string[] = [], failures: unknown[] = [];
	const options = { argv: ['lightscaper', `--lightscaper-managed-smoke-plan=${planPath}`, `--lightscaper-managed-smoke-nonce=${NONCE}`],
		profilePath, rendererScript: 'private inventoried renderer is not executed by this admission test',
		quit() { assert.fail('Admission must not quit an app.'); }, reportFailure(error: unknown) { failures.push(error); },
		relocateApplicationData(path: string) { relocated.push(path); } };
	return { options, profilePath, planPath, plan, relocated, failures };
}
void test('authenticated ordinary private smoke requests exactly its own native application-data relocation', OPTIONS, async context => fixture(context, false, async value => {
	assert.ok(create(value.options)); assert.deepEqual(value.relocated, [value.profilePath]); assert.deepEqual(value.failures, []);
}));
void test('authenticated registered primary preserves the ordinary secondary default application-data path', OPTIONS, async context => fixture(context, true, async value => {
	assert.ok(create(value.options)); assert.deepEqual(value.relocated, []); assert.deepEqual(value.failures, []);
}));
void test('unpaired or refused smoke never relocates native application data', OPTIONS, async context => fixture(context, false, async value => {
	assert.equal(create({ ...value.options, argv: ['lightscaper'] }), undefined); assert.deepEqual(value.relocated, []);
	const fixture = value.plan.renderer.fixtures[0]!; fixture.sha256 = 'f'.repeat(64);
	await writeFile(value.planPath, JSON.stringify(value.plan), { mode: 0o600 });
	assert.throws(() => create(value.options), /fixture bytes differ/u); assert.deepEqual(value.relocated, []);
}));
void test('native entry delegates profile relocation only to the authenticated private-plan creator', async () => {
	const source = await readFile(new URL('../desktop/lightscaper-main-current-v1.ts', import.meta.url), 'utf8');
	assert.match(source, /relocateApplicationData: profilePath => \{ app\.setPath\('appData', profilePath\); \}/u);
	assert.doesNotMatch(source, /if \(hooks\) app\.setPath/u);
});
