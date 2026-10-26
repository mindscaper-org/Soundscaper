/* SPDX-License-Identifier: AGPL-3.0-only */
import { validateAssistanceStagedInputClaim } from './assistance-data-claims.ts';
export const KEYING_SOURCE_READ_MAXIMUM_BYTES = 4 * 1024 ** 2;
export function keyingDecodeRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid keying source decode request.');
	const record = value as Readonly<Record<string, unknown>>;
	if (Reflect.ownKeys(record).length !== keys.length || Reflect.ownKeys(record).some(key => !keys.includes(String(key)))) throw new TypeError('Unsupported keying source decode fields.');
	return record;
}
export function validateKeyingSourceDecodeRequest(value: unknown) {
	const record = keyingDecodeRecord(value, ['contractVersion', 'jobId', 'source', 'width', 'height', 'frameCount', 'frameRate']);
	const source = validateAssistanceStagedInputClaim(record.source);
	const rate = keyingDecodeRecord(record.frameRate, ['num', 'den']);
	if (record.contractVersion !== 1 || record.jobId !== source.jobId || source.role !== 'video') throw new TypeError('Keying source decode requires its job-owned original video.');
	for (const [field, maximum] of [['width', 4096], ['height', 4096], ['frameCount', 100_000]] as const) {
		if (!Number.isSafeInteger(record[field]) || Number(record[field]) < 1 || Number(record[field]) > maximum) throw new RangeError(`Invalid keying source ${field}.`);
	}
	if (![rate.num, rate.den].every(part => Number.isSafeInteger(part) && Number(part) > 0 && Number(part) <= 0x7fff_ffff)
		|| Number(rate.num) / Number(rate.den) < 0.1 || Number(rate.num) / Number(rate.den) > 240) throw new RangeError('Invalid keying source frame rate.');
	const width = Number(record.width), height = Number(record.height), frameCount = Number(record.frameCount);
	if (width * height * 4 * frameCount + source.byteLength > 8 * 1024 ** 3) throw new RangeError('The keying source exceeds its native decode byte limit.');
	return Object.freeze({ contractVersion: 1 as const, jobId: source.jobId, source, width, height, frameCount,
		frameRate: Object.freeze({ num: Number(rate.num), den: Number(rate.den) }) });
}
