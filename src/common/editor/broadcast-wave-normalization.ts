/* SPDX-License-Identifier: AGPL-3.0-only */
import type { BextVersion, BextLoudnessField } from './broadcast-wave.ts';
import type { LocalizedPresentationMessage } from '../i18n/presentation-message.ts';
import { fileValidationFailure as failure } from './file-validation-failure.ts';
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const LOUDNESS_MAXIMUM = 99.99;
const FIELD_NAMES: Readonly<Record<string, readonly [string, string]>> = {
	description: ['bextDescription', 'Description'], originator: ['bextOriginator', 'Originator'],
	originatorReference: ['bextOriginatorReference', 'Originator reference'], codingHistory: ['bextCodingHistory', 'Coding history'],
	loudnessValue: ['bextLoudnessValue', 'Integrated loudness (LUFS)'], loudnessRange: ['bextLoudnessRange', 'Loudness range (LU)'],
	maxTruePeakLevel: ['bextMaxTruePeakLevel', 'Maximum true peak (dBTP)'], maxMomentaryLoudness: ['bextMaxMomentaryLoudness', 'Maximum momentary loudness (LUFS)'],
	maxShortTermLoudness: ['bextMaxShortTermLoudness', 'Maximum short-term loudness (LUFS)'],
};
function fieldMessage(field: string): LocalizedPresentationMessage {
	const [key, fallback] = Object.hasOwn(FIELD_NAMES, field) ? FIELD_NAMES[field]! : ['bextCodingHistory', 'Coding history'];
	return { key: key!, fallback: fallback! };
}

export function normalizeVersion(value: BextVersion): BextVersion {
	if (value !== 0 && value !== 1 && value !== 2) throw failure(new RangeError('BEXT version must be 0, 1, or 2.'), 'bext', 'version', 'bextVersion');
	return value;
}

export function normalizeFixedText(value: string, field: string, maximum: number): string {
	if (typeof value !== 'string') throw failure(new TypeError(`BEXT ${field} must be a string.`), 'bext', 'bextText', 'bextText', { field: fieldMessage(field) });
	if (value.length > maximum) throw failure(new RangeError(`BEXT ${field} must contain at most ${maximum} ASCII characters.`), 'bext', 'bextTextLength', 'bextTextLength', { field: fieldMessage(field), maximum });
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 0x20 || code > 0x7e) throw failure(new RangeError(`BEXT ${field} must contain printable ASCII only.`), 'bext', 'bextAscii', 'bextAscii', { field: fieldMessage(field) });
	}
	return value;
}

export function normalizeDate(value: string): string {
	if (typeof value !== 'string') throw failure(new TypeError('BEXT origination date must be a string.'), 'bext', 'bextDate', 'bextDate');
	if (!validDate(value)) throw failure(new RangeError('BEXT origination date must be empty or a valid YYYY-MM-DD-style date.'), 'bext', 'bextDate', 'bextDate');
	return value;
}

export function normalizeTime(value: string): string {
	if (typeof value !== 'string') throw failure(new TypeError('BEXT origination time must be a string.'), 'bext', 'bextTime', 'bextTime');
	if (!validTime(value)) throw failure(new RangeError('BEXT origination time must be empty or a valid HH:MM:SS-style time.'), 'bext', 'bextTime', 'bextTime');
	return value;
}

export function validDate(value: string): boolean {
	if (!value) return true;
	const match = /^(\d{4})[\x20-\x7e](\d{2})[\x20-\x7e](\d{2})$/u.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12) return false;
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return day >= 1 && day <= (days[month - 1] ?? 0);
}

export function validTime(value: string): boolean {
	if (!value) return true;
	const match = /^(\d{2})[\x20-\x7e](\d{2})[\x20-\x7e](\d{2})$/u.exec(value);
	if (!match) return false;
	return Number(match[1]) <= 23 && Number(match[2]) <= 59 && Number(match[3]) <= 59;
}

export function normalizeTimeReference(value: string): string {
	if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
		throw failure(new RangeError('BEXT timeReference must be an unsigned 64-bit decimal string.'), 'bext', 'bextTimeReference', 'bextTimeReference');
	}
	const parsed = BigInt(value);
	if (parsed > UINT64_MAX) throw failure(new RangeError('BEXT timeReference must be an unsigned 64-bit decimal string.'), 'bext', 'bextTimeReference', 'bextTimeReference');
	return parsed.toString();
}

export function normalizeUmid(value: string): string {
	if (typeof value !== 'string') throw failure(new TypeError('BEXT umid must be a hexadecimal string.'), 'bext', 'bextUmid', 'bextUmid');
	if (!value) return '';
	const unprefixed = value.trim().replace(/^0x/iu, '');
	if (/[^0-9a-f:\s-]/iu.test(unprefixed)) throw failure(new RangeError('BEXT umid must be hexadecimal.'), 'bext', 'bextUmid', 'bextUmid');
	const compact = unprefixed.replace(/[:\s-]/gu, '');
	if (!/^[0-9a-f]+$/iu.test(compact)) throw failure(new RangeError('BEXT umid must be hexadecimal.'), 'bext', 'bextUmid', 'bextUmid');
	if (compact.length !== 64 && compact.length !== 128) {
		throw failure(new RangeError('BEXT umid must contain exactly 32 or 64 bytes.'), 'bext', 'bextUmid', 'bextUmid');
	}
	const normalized = `${compact.toLowerCase()}${compact.length === 64 ? '0'.repeat(64) : ''}`;
	return /^0+$/u.test(normalized) ? '' : normalized;
}

export function normalizeLoudness(value: number | null, field: BextLoudnessField): number | null {
	if (value == null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw failure(new RangeError(`BEXT ${field} must be null or a finite number.`), 'bext', 'bextFinite', 'bextFinite', { field: fieldMessage(field) });
	}
	const minimum = loudnessMinimum(field);
	if (value < minimum || value > LOUDNESS_MAXIMUM) {
		throw failure(new RangeError(`BEXT ${field} must be between ${minimum.toFixed(2)} and 99.99.`), 'bext', 'bextBounds', 'bextBounds', { field: fieldMessage(field), minimum, maximum: LOUDNESS_MAXIMUM });
	}
	return roundLoudness(value) / 100;
}

export function loudnessMinimum(field: BextLoudnessField): number {
	return field === 'loudnessRange' ? 0 : -LOUDNESS_MAXIMUM;
}

export function roundLoudness(value: number): number {
	if (value === 0) return 0;
	const magnitude = Math.abs(value) * 100;
	const tolerance = Number.EPSILON * Math.max(1, magnitude) * 4;
	return Math.sign(value) * Math.floor(magnitude + 0.5 + tolerance);
}

export function normalizeCodingHistory(value: string): string {
	const normalized = normalizeCodingText(value, 'codingHistory').replace(/\r\n?|\n/gu, '\n');
	return normalized && !normalized.endsWith('\n') ? `${normalized}\n` : normalized;
}

function normalizeCodingText(value: string, field: string): string {
	if (typeof value !== 'string') throw failure(new TypeError(`BEXT ${field} must be a string.`), 'bext', 'bextText', 'bextText', { field: fieldMessage(field) });
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code !== 0x09 && code !== 0x0a && code !== 0x0d && (code < 0x20 || code > 0x7e)) {
			throw failure(new RangeError(`BEXT ${field} must contain ASCII text only.`), 'bext', 'bextAscii', 'bextAscii', { field: fieldMessage(field) });
		}
	}
	return value;
}

