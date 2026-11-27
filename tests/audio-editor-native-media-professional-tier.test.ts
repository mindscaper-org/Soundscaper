/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	evaluateNativeMediaProfileAdmission,
	nativeMediaProfile,
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PRESERVED_BIT_DEPTH,
	NATIVE_MEDIA_PROFESSIONAL_PROFILES,
	NATIVE_MEDIA_PROFILE_POLICY_ROW_IDS,
} from '../src/common/editor/native-media-professional-profiles.ts';
import {
	createUnreportedVideoSourceCharacteristicsV25,
	normalizeVideoSourceCharacteristicsV25,
	resolveVideoSourceHdrClaimV25,
	VIDEO_SOURCE_V25_BIT_DEPTHS,
	videoSourceCharacteristicsV25AreReported,
	VideoSourceProfessionalCharacteristicsV25Error,
} from '../src/common/editor/video-source-professional-characteristics-v25.ts';

const ALL_ROWS = NATIVE_MEDIA_PROFILE_POLICY_ROW_IDS;

test('the unused flat native-media characteristics adapter is absent from the source tree', async () => {
	const adapter = new URL('../src/common/editor/native-media-professional-characteristics.ts', import.meta.url);
	await assert.rejects(access(adapter), { code: 'ENOENT' });
});

test('unreported professional characteristics report nothing at all', () => {
	const unreported = createUnreportedVideoSourceCharacteristicsV25();

	assert.deepEqual(unreported, normalizeVideoSourceCharacteristicsV25(null));
	assert.equal(Object.hasOwn(unreported, 'professionalCharacteristics'), false);
	assert.deepEqual(resolveVideoSourceHdrClaimV25(unreported), {
		transfer: 'unreported', hdr10Metadata: false, wideGamut: false,
	});
});

test('an unrecognized transfer stays unreported rather than falling back to SDR', () => {
	assert.equal(claim({ colour: { transfer: 'bt709' } }).transfer, 'sdr');
	assert.equal(claim({ colour: { transfer: 'smpte2084' } }).transfer, 'pq');
	assert.equal(claim({ colour: { transfer: 'arib-std-b67' } }).transfer, 'hlg');
	assert.equal(claim({ colour: { transfer: 'some-future-tag' } }).transfer, 'unreported');
	assert.equal(claim({}).transfer, 'unreported');
});

test('a PQ transfer without ST 2086 and CTA-861.3 metadata is not HDR10', () => {
	const pqOnly = claim({ colour: { transfer: 'smpte2084', primaries: 'bt2020' } });
	assert.deepEqual(pqOnly, { transfer: 'pq', hdr10Metadata: false, wideGamut: true });

	const full = claim({
		colour: {
			transfer: 'smpte2084',
			primaries: 'bt2020',
			masteringDisplay: masteringDisplay(),
			contentLight: { maximumContentLightLevel: 1_000, maximumFrameAverageLightLevel: 400 },
		},
	});
	assert.deepEqual(full, { transfer: 'pq', hdr10Metadata: true, wideGamut: true });

	// PQ with Rec.709 primaries is PQ, but it is not a wide-gamut claim.
	assert.equal(claim({ colour: { transfer: 'smpte2084', primaries: 'bt709' } }).wideGamut, false);
});

test('mastering-display metadata is reported whole or not at all', () => {
	const partial = { ...masteringDisplay() } as Record<string, unknown>;
	delete partial.whitePoint;

	assert.throws(
		() => normalizeVideoSourceCharacteristicsV25({ colour: { masteringDisplay: partial } }),
		/whole or not at all/u,
	);
	assert.throws(() => normalizeVideoSourceCharacteristicsV25({
		colour: {
			masteringDisplay: {
				...masteringDisplay(),
				minimumLuminance: { num: 20_000, den: 10_000 },
				maximumLuminance: { num: 1, den: 10_000 },
			},
		},
	}), /minimum luminance exceeds its maximum/u);
	assert.throws(() => normalizeVideoSourceCharacteristicsV25({
		colour: { contentLight: { maximumContentLightLevel: 100, maximumFrameAverageLightLevel: 200 } },
	}), /cannot exceed the maximum content light level/u);
});

test('equal rational luminance remains valid in the source characteristics', () => {
	const minimumLuminance = { num: 999_999_997, den: 999_999_999 };
	const equal = normalizeVideoSourceCharacteristicsV25({
		colour: {
			masteringDisplay: {
				...masteringDisplay(), minimumLuminance, maximumLuminance: { ...minimumLuminance },
			},
		},
	});
	assert.deepEqual(equal.colour.masteringDisplay?.maximumLuminance, minimumLuminance);
});

test('probed colour and alpha facts are validated rather than coerced', () => {
	const characteristics = normalizeVideoSourceCharacteristicsV25({
		bitDepth: 10,
		pixelFormat: 'yuv422p10le',
		chromaFormat: '4:2:2',
		colour: { range: 'limited' },
		hasAlpha: true,
		alphaMode: 'premultiplied',
		alphaInterpretation: 'transparency',
	});

	assert.equal(characteristics.bitDepth, 10);
	assert.equal(characteristics.pixelFormat, 'yuv422p10le');
	assert.equal(videoSourceCharacteristicsV25AreReported(characteristics), true);
	assert.deepEqual([...VIDEO_SOURCE_V25_BIT_DEPTHS], [8, 10, 12, 16, 32]);

	for (const [value, pattern] of [
		[{ bitDepth: 9 }, /bitDepth is unsupported/u],
		[{ chromaFormat: '4:1:1' }, /chromaFormat is unsupported/u],
		[{ colour: { range: 'video' } }, /range is unsupported/u],
		[{ alphaMode: 'associated' }, /alphaMode is unsupported/u],
		[{ hasAlpha: 'yes' }, /hasAlpha must be a boolean/u],
		[{ pixelFormat: 'yuv 422' }, /pixelFormat must be a bounded probe tag/u],
		[{ unknownKey: 1 }, /unsupported key unknownKey/u],
		[{ hasAlpha: false, alphaMode: 'straight' }, /without alpha cannot carry an alpha mode/u],
	] as const) {
		assert.throws(
			() => normalizeVideoSourceCharacteristicsV25(value),
			pattern,
		);
	}
	assert.throws(
		() => normalizeVideoSourceCharacteristicsV25({ colour: { masteringDisplay: 7 } }),
		VideoSourceProfessionalCharacteristicsV25Error,
	);
});

test('the required professional baseline covers every named decode and encode row', () => {
	const ids = NATIVE_MEDIA_PROFESSIONAL_PROFILES.map((profile) => profile.id);

	assert.deepEqual(ids.filter((id) => id.startsWith('decode-')), [
		'decode-h264', 'decode-hevc', 'decode-vp9', 'decode-av1',
		'decode-prores', 'decode-dnxhr',
		'decode-png-sequence', 'decode-tiff-sequence', 'decode-openexr-sequence',
	]);
	assert.deepEqual(ids.filter((id) => id.startsWith('encode-')), [
		'encode-mp4-h264', 'encode-hevc-main10-hdr10', 'encode-hevc-main10-sdr',
		'encode-webm-vp8', 'encode-webm-vp9', 'encode-webm-vp9-alpha', 'encode-webm-av1',
		'encode-mov-prores-proxy', 'encode-mov-prores-422-hq', 'encode-mov-prores-4444',
		'encode-mxf-dnxhr-hqx', 'encode-matroska-ffv1',
		'encode-png-sequence', 'encode-tiff-sequence', 'encode-openexr-sequence',
	]);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(NATIVE_MEDIA_PROFESSIONAL_PROFILES.every((profile) => profile.policyRowIds.length > 0), true);
});

test('image-sequence profiles disclose the selected RGBA8 SDR preservation ceiling', () => {
	assert.equal(NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PRESERVED_BIT_DEPTH, 8);
	for (const id of [
		'decode-png-sequence', 'decode-tiff-sequence', 'decode-openexr-sequence',
		'encode-png-sequence', 'encode-tiff-sequence', 'encode-openexr-sequence',
	]) {
		const profile = nativeMediaProfile(id);
		assert.equal(profile?.maximumBitDepth, 8, `${id} must not claim high-precision preservation`);
		assert.equal(profile?.preservesHdrMetadata, false, `${id} must not claim HDR preservation`);
		assert.equal(
			profile?.supportsAlpha, id.startsWith('encode-'),
			`${id} must report the selected decode/export alpha boundary`,
		);
	}
	for (const [profileId, bitDepth, transfer, refusals] of [
		['decode-png-sequence', 16, 'bt709', ['bit-depth-not-preserved']],
		['decode-tiff-sequence', 16, 'bt709', ['bit-depth-not-preserved']],
		['decode-openexr-sequence', 32, 'smpte2084', [
			'bit-depth-not-preserved', 'hdr-metadata-not-preserved',
		]],
	] as const) {
		const verdict = evaluateNativeMediaProfileAdmission({
			profileId,
			source: normalizeVideoSourceCharacteristicsV25({
				bitDepth, chromaFormat: '4:4:4', hasAlpha: true,
				colour: { transfer, primaries: transfer === 'smpte2084' ? 'bt2020' : 'bt709' },
			}),
			recordedLicensingRowIds: ALL_ROWS,
			requirements: { preserveBitDepth: true, preserveHdrMetadata: true },
		});
		assert.equal(verdict.admitted, false);
		assert.deepEqual(verdict.refusals, refusals);
	}
	const alpha = evaluateNativeMediaProfileAdmission({
		profileId: 'decode-png-sequence',
		source: normalizeVideoSourceCharacteristicsV25({
			bitDepth: 8, chromaFormat: '4:4:4', hasAlpha: true,
			colour: { primaries: 'bt709', transfer: 'iec61966-2-1' },
		}),
		recordedLicensingRowIds: ALL_ROWS,
		requirements: { preserveAlpha: true },
	});
	assert.deepEqual(alpha.refusals, ['alpha-not-preserved']);
});

test('every profile policy row retains a named distribution disposition', async () => {
	const matrix = JSON.parse(await readFile(
		new URL('../config/production-licensing-matrix.json', import.meta.url), 'utf8',
	)) as { nativeFormatPolicies: { id: string; status: string; blocker: string }[] };
	const rows = new Map(matrix.nativeFormatPolicies.map((row) => [row.id, row]));

	for (const rowId of ALL_ROWS) {
		const row = rows.get(rowId);
		assert.ok(row, `the licensing register is missing ${rowId}`);
		assert.equal(row.status, 'blocked', `${rowId} must name its distribution restriction`);
		assert.ok(row.blocker.length > 0, `${rowId} needs a named blocker`);
	}
});

test('unresolved licensing rows are metadata, not execution refusals', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mov-prores-4444',
		source: normalizeVideoSourceCharacteristicsV25({
			bitDepth: 12, chromaFormat: '4:4:4', hasAlpha: true, colour: { transfer: 'bt709' },
		}),
	});

	assert.equal(verdict.admitted, true);
	assert.deepEqual(verdict.refusals, []);
	assert.deepEqual(verdict.unresolvedLicensingRowIds, [
		'codec-native-ffmpeg-current-set', 'codec-encode-prores-mov-4444',
	]);
});

test('an unknown profile is refused rather than treated as permissive', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mov-prores-8888',
		source: createUnreportedVideoSourceCharacteristicsV25(),
		recordedLicensingRowIds: ALL_ROWS,
	});

	assert.deepEqual(verdict.refusals, ['profile-unknown']);
	assert.equal(nativeMediaProfile('encode-mov-prores-8888'), null);
});

test('a required bit depth, chroma, HDR, or alpha a profile cannot hold is refused up front', () => {
	const hdrAlpha = normalizeVideoSourceCharacteristicsV25({
		bitDepth: 12,
		chromaFormat: '4:4:4',
		hasAlpha: true,
		colour: {
			transfer: 'smpte2084',
			primaries: 'bt2020',
			masteringDisplay: masteringDisplay(),
			contentLight: { maximumContentLightLevel: 1_000, maximumFrameAverageLightLevel: 400 },
		},
	});
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mp4-h264',
		source: hdrAlpha,
		recordedLicensingRowIds: ALL_ROWS,
		requirements: {
			preserveBitDepth: true, preserveChroma: true,
			preserveHdrMetadata: true, preserveAlpha: true,
		},
	});

	assert.equal(verdict.admitted, false);
	assert.deepEqual(verdict.refusals, [
		'bit-depth-not-preserved',
		'chroma-not-preserved',
		'hdr-metadata-not-preserved',
		'alpha-not-preserved',
	]);
	assert.deepEqual(verdict.disclosures, []);
});

test('a profile that can hold every requirement is admitted', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mov-prores-4444',
		source: normalizeVideoSourceCharacteristicsV25({
			bitDepth: 12,
			chromaFormat: '4:4:4',
			hasAlpha: true,
			colour: {
				transfer: 'smpte2084',
				primaries: 'bt2020',
				masteringDisplay: masteringDisplay(),
				contentLight: { maximumContentLightLevel: 1_000, maximumFrameAverageLightLevel: 400 },
			},
		}),
		recordedLicensingRowIds: ALL_ROWS,
		requirements: {
			preserveBitDepth: true, preserveChroma: true,
			preserveHdrMetadata: true, preserveAlpha: true,
		},
	});

	assert.deepEqual(verdict, {
		admitted: true,
		profileId: 'encode-mov-prores-4444',
		refusals: [],
		disclosures: [],
		unresolvedLicensingRowIds: [],
	});
});

test('a loss the caller did not require is admitted but never silent', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mp4-h264',
		source: normalizeVideoSourceCharacteristicsV25({
			bitDepth: 12,
			chromaFormat: '4:4:4',
			hasAlpha: true,
			colour: { transfer: 'smpte2084', primaries: 'bt2020' },
		}),
		recordedLicensingRowIds: ALL_ROWS,
	});

	assert.equal(verdict.admitted, true);
	assert.deepEqual(verdict.disclosures, [
		'bit-depth-reduced', 'chroma-subsampled', 'hdr-metadata-dropped', 'alpha-dropped',
	]);
});

test('an unreported fact is disclosed, so alpha is never lost without saying so', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mp4-h264',
		source: createUnreportedVideoSourceCharacteristicsV25(),
		recordedLicensingRowIds: ALL_ROWS,
	});

	assert.equal(verdict.admitted, true);
	assert.deepEqual(verdict.disclosures, [
		'bit-depth-unreported', 'chroma-unreported', 'transfer-unreported', 'alpha-presence-unreported',
	]);
});

test('a requirement that probing cannot establish is refused, not assumed satisfied', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-matroska-ffv1',
		source: createUnreportedVideoSourceCharacteristicsV25(),
		recordedLicensingRowIds: ALL_ROWS,
		requirements: { preserveBitDepth: true, preserveAlpha: true },
	});

	assert.equal(verdict.admitted, false);
	assert.deepEqual(verdict.refusals, ['bit-depth-not-preserved', 'alpha-not-preserved']);
});

test('HDR10 metadata probing established is disclosed even when the transfer tag is not', () => {
	const hdr10 = {
		bitDepth: 8,
		chromaFormat: '4:2:0',
		hasAlpha: false,
		colour: {
			primaries: 'bt2020',
			masteringDisplay: masteringDisplay(),
			contentLight: { maximumContentLightLevel: 1_000, maximumFrameAverageLightLevel: 400 },
		},
	};

	for (const transfer of ['vendor-log-3', null]) {
		const carrier = normalizeVideoSourceCharacteristicsV25({ ...hdr10, colour: { ...hdr10.colour, transfer } });
		assert.deepEqual(resolveVideoSourceHdrClaimV25(carrier), {
			transfer: 'unreported', hdr10Metadata: true, wideGamut: false,
		});

		const dropped = evaluateNativeMediaProfileAdmission({
			profileId: 'encode-mp4-h264',
			source: carrier,
			recordedLicensingRowIds: ALL_ROWS,
		});
		assert.equal(dropped.admitted, true);
		assert.deepEqual(dropped.disclosures, ['transfer-unreported', 'hdr-metadata-dropped']);

		const required = evaluateNativeMediaProfileAdmission({
			profileId: 'encode-mp4-h264',
			source: carrier,
			recordedLicensingRowIds: ALL_ROWS,
			requirements: { preserveHdrMetadata: true },
		});
		assert.equal(required.admitted, false);
		assert.deepEqual(required.refusals, ['hdr-metadata-not-preserved']);

		const held = evaluateNativeMediaProfileAdmission({
			profileId: 'encode-mov-prores-422-hq',
			source: carrier,
			recordedLicensingRowIds: ALL_ROWS,
		});
		assert.deepEqual(held.disclosures, ['transfer-unreported']);
	}
});

test('an SDR source loses nothing to a profile that carries no HDR metadata', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-webm-vp9',
		source: normalizeVideoSourceCharacteristicsV25({
			bitDepth: 8, chromaFormat: '4:2:0', hasAlpha: false, colour: { transfer: 'bt709' },
		}),
		recordedLicensingRowIds: ALL_ROWS,
		requirements: { preserveBitDepth: true, preserveChroma: true, preserveAlpha: true },
	});

	assert.deepEqual(verdict.refusals, []);
	assert.deepEqual(verdict.disclosures, []);
});

function claim(overrides: Record<string, unknown>) {
	return resolveVideoSourceHdrClaimV25(normalizeVideoSourceCharacteristicsV25(overrides));
}

function masteringDisplay() {
	return {
		redPrimary: { x: { num: 34_000, den: 50_000 }, y: { num: 16_000, den: 50_000 } },
		greenPrimary: { x: { num: 13_250, den: 50_000 }, y: { num: 34_500, den: 50_000 } },
		bluePrimary: { x: { num: 7_500, den: 50_000 }, y: { num: 3_000, den: 50_000 } },
		whitePoint: { x: { num: 15_635, den: 50_000 }, y: { num: 16_450, den: 50_000 } },
		minimumLuminance: { num: 50, den: 10_000 },
		maximumLuminance: { num: 10_000_000, den: 10_000 },
	};
}
