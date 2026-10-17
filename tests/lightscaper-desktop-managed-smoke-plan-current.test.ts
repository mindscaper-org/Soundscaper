/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import {
	parseLightscaperManagedSmokeArgumentsCurrentV1,
	validateLightscaperManagedSmokePlanCurrentV1,
} from '../desktop/lightscaper-managed-smoke-main-current-v1.ts';

const NONCE = '0123456789abcdef0123456789abcdef';
const ROOT = join(process.cwd(), 'private-managed-smoke');
function plan(stage: 1 | 2 | 3 = 1) {
	return { schemaVersion: 1, nonce: NONCE, stage, profilePath: join(ROOT, 'profile'),
		renderer: { nonce: NONCE, stage, locale: 'en', fixtures: [
			{ name: 'Owned raster.png', mimeType: 'image/png', base64: 'AQID', byteLength: 3, sha256: 'a'.repeat(64) },
			{ name: 'Owned Bayer.dng', mimeType: 'image/x-adobe-dng', base64: 'BAUG', byteLength: 3, sha256: 'b'.repeat(64) },
		], archive: stage === 2 ? { name: 'Photo library.liscape', mimeType: 'application/vnd.soundscaper.scape+zip',
			base64: 'BwgJ', byteLength: 3, sha256: 'c'.repeat(64) } : null,
			expectedFingerprint: stage === 1 ? null : 'd'.repeat(64), expectedNamespace: null,
			backupSuggestedName: 'Photo library.liscape' } };
}

test('managed smoke activation requires its exact nonce and one private plan argument', () => {
	assert.equal(parseLightscaperManagedSmokeArgumentsCurrentV1(['app']), null);
	const path = join(ROOT, `${NONCE}.stage-1.json`);
	assert.deepEqual(parseLightscaperManagedSmokeArgumentsCurrentV1(['app', `--lightscaper-managed-smoke-plan=${path}`,
		`--lightscaper-managed-smoke-nonce=${NONCE}`]), { planPath: path, nonce: NONCE });
	for (const args of [[`--lightscaper-managed-smoke-plan=${path}`], [`--lightscaper-managed-smoke-nonce=${NONCE}`],
		[`--lightscaper-managed-smoke-plan=${path}`, `--lightscaper-managed-smoke-nonce=${NONCE}`, `--lightscaper-managed-smoke-nonce=${NONCE}`],
		[`--lightscaper-managed-smoke-plan=${path}`, '--lightscaper-managed-smoke-nonce=wrong'],
		[`--lightscaper-managed-smoke-plan=${path}`, `--lightscaper-managed-smoke-nonce=${NONCE}`, '--lightscaper-managed-smoke-extra=1']]) {
		assert.throws(() => parseLightscaperManagedSmokeArgumentsCurrentV1(args), TypeError);
	}
});

test('managed smoke plans cannot escape their nonce-stage profile or expand renderer authority', () => {
	for (const stage of [1, 2, 3] as const) {
		const value = plan(stage), authority = { planPath: join(ROOT, `${NONCE}.stage-${stage}.json`), profilePath: join(ROOT, 'profile'), nonce: NONCE };
		assert.deepEqual(validateLightscaperManagedSmokePlanCurrentV1(value, authority), value);
		for (const changed of [ { ...value, profilePath: join(ROOT, '..', 'other-profile') },
			{ ...value, nonce: 'f'.repeat(32) }, { ...value, stage: 4 }, { ...value, outputPath: '/tmp/escape' },
			{ ...value, renderer: { ...value.renderer, exportBaseName: '../escape' } },
			{ ...value, renderer: { ...value.renderer, fixtures: Array.from({ length: 3 }, () => value.renderer.fixtures[0]) } } ]) {
			assert.throws(() => validateLightscaperManagedSmokePlanCurrentV1(changed, authority));
		}
	}
});
