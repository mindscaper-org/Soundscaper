import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { DesktopSettingsStore } from '../desktop/settings.js';
import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';

const SHA_A = '12'.repeat(32);
const SHA_B = '34'.repeat(32);
const SHA_D = '78'.repeat(32);

test('schema-1 desktop settings default external FFmpeg selection to null', async (context) => {
	const fixture = await settingsFixture(context, {
		schemaVersion: 1,
		locale: 'en',
		updatesEnabled: true,
	});
	assert.equal((await fixture.settings.load(['en'])).externalFfmpegSelection, null);
});

test('external FFmpeg selection and exact probe evidence persist atomically', async (context) => {
	const fixture = await settingsFixture(context);
	await fixture.settings.load(['en']);
	const executablePath = join(fixture.root, 'tools', '..', 'bin', 'ffmpeg');
	const selected = await fixture.settings.setExternalFfmpegSelection(executablePath);
	assert.deepEqual(selected, {
		executablePath: resolve(executablePath),
		identity: null,
		capabilities: null,
	});
	assert.ok(Object.isFrozen(selected));

	const probed = await fixture.settings.setExternalFfmpegProbeMetadata({
		executablePath,
		identity: {
			version: '9.0.1',
			ffmpegSha256: SHA_A,
			ffprobePath: resolve(join(fixture.root, 'bin', 'ffprobe')),
			ffprobeSha256: SHA_B,
			executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({
				ffmpegPath: resolve(executablePath), ffmpegSha256: SHA_A,
				ffprobePath: resolve(join(executablePath, '..', 'ffprobe')), ffprobeSha256: SHA_B,
			}),
		},
		capabilities: {
			digest: SHA_D,
			probedAtEpochMs: 1_787_605_200_000,
		},
	});
	assert.ok(Object.isFrozen(probed.identity));
	assert.ok(Object.isFrozen(probed.capabilities));

	const reopened = new DesktopSettingsStore(fixture.filePath);
	const durable = (await reopened.load(['en'])).externalFfmpegSelection;
	assert.deepEqual(durable, probed);
	assert.deepEqual(JSON.parse(await readFile(fixture.filePath, 'utf8')).externalFfmpegSelection, probed);
});

test('changing or clearing the executable invalidates all external FFmpeg probe evidence', async (context) => {
	const fixture = await settingsFixture(context);
	await fixture.settings.load(['en']);
	const first = join(fixture.root, 'first', 'ffmpeg');
	const second = join(fixture.root, 'second', 'ffmpeg');
	await fixture.settings.setExternalFfmpegSelection(first);
	const firstProbe = await fixture.settings.setExternalFfmpegProbeMetadata(probeMetadata(first));
	assert.deepEqual(
		await fixture.settings.setExternalFfmpegSelection(join(fixture.root, 'first', '..', 'first', 'ffmpeg')),
		firstProbe,
		'reselecting the same canonical executable retains its probe evidence',
	);

	assert.deepEqual(await fixture.settings.setExternalFfmpegSelection(second), {
		executablePath: resolve(second), identity: null, capabilities: null,
	});
	await assert.rejects(
		() => fixture.settings.setExternalFfmpegProbeMetadata(probeMetadata(first)),
		/currently selected/iu,
	);
	assert.deepEqual(fixture.settings.snapshot().externalFfmpegSelection, {
		executablePath: resolve(second), identity: null, capabilities: null,
	});
	await fixture.settings.setExternalFfmpegProbeMetadata(probeMetadata(second));
	assert.deepEqual(await fixture.settings.clearExternalFfmpegProbeMetadata(second), {
		executablePath: resolve(second), identity: null, capabilities: null,
	});

	assert.equal(await fixture.settings.clearExternalFfmpegSelection(), null);
	assert.equal(fixture.settings.snapshot().externalFfmpegSelection, null);
});

test('loading corrupt external FFmpeg evidence keeps only independently valid persisted fields', async (context) => {
	for (const executablePath of [42, '', 'relative/ffmpeg', `/bin/ffmpeg\0other`, `/${'x'.repeat(4_097)}`]) {
		const fixture = await settingsFixture(context, {
			schemaVersion: 1, locale: 'en',
			externalFfmpegSelection: { executablePath, identity: null, capabilities: null },
		});
		assert.equal((await fixture.settings.load(['en'])).externalFfmpegSelection, null);
	}

	const executablePath = resolve('/opt/media/../bin/ffmpeg');
	for (const metadata of [
		probeMetadata(executablePath, { version: 9 }),
		probeMetadata(executablePath, { version: `9.0\0snapshot` }),
		probeMetadata(executablePath, { ffmpegSha256: 'not-a-digest' }),
		probeMetadata(executablePath, { ffprobePath: 'relative/ffprobe' }),
		probeMetadata(executablePath, { ffprobeSha256: 'AB'.repeat(32) }),
		probeMetadata(executablePath, { executablePairClosureSha256: null }),
		{ ...probeMetadata(executablePath), identity: null },
	]) {
		const fixture = await settingsFixture(context, {
			schemaVersion: 1, locale: 'en', externalFfmpegSelection: metadata,
		});
		assert.deepEqual((await fixture.settings.load(['en'])).externalFfmpegSelection, {
			executablePath, identity: null, capabilities: null,
		});
	}
	for (const capabilities of [
		{ digest: 'bad', probedAtEpochMs: 1 },
		{ digest: SHA_D, probedAtEpochMs: 1.5 },
	]) {
		const metadata = probeMetadata(executablePath);
		const fixture = await settingsFixture(context, {
			schemaVersion: 1, locale: 'en',
			externalFfmpegSelection: { ...metadata, capabilities },
		});
		assert.deepEqual((await fixture.settings.load(['en'])).externalFfmpegSelection, {
			executablePath, identity: metadata.identity, capabilities: null,
		});
	}
});

function probeMetadata(executablePath, identityOverride = {}) {
	return {
		executablePath,
		identity: {
			version: '9.0.1',
			ffmpegSha256: SHA_A,
			ffprobePath: resolve(join(executablePath, '..', 'ffprobe')),
			ffprobeSha256: SHA_B,
			executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({
				ffmpegPath: resolve(executablePath), ffmpegSha256: SHA_A,
				ffprobePath: resolve(join(executablePath, '..', 'ffprobe')), ffprobeSha256: SHA_B,
			}),
			...identityOverride,
		},
		capabilities: { digest: SHA_D, probedAtEpochMs: 1_787_605_200_000 },
	};
}

async function settingsFixture(context, persisted = null) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-ffmpeg-settings-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'settings.json');
	if (persisted) await writeFile(filePath, `${JSON.stringify(persisted)}\n`, 'utf8');
	return { root, filePath, settings: new DesktopSettingsStore(filePath) };
}
