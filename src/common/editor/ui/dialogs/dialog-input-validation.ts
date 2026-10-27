/* SPDX-License-Identifier: AGPL-3.0-only */
import type { RationalInput } from '../../timeline-time.ts';
import type { LocalizedPresentationMessage } from '../../../i18n/presentation-message.ts';
import { FILE_VALIDATION_COPY } from '../../../i18n/editor-file-validation-copy.ts';
import { VIDEO_RETIME_ADDITIONAL_COPY } from '../../../i18n/editor-video-retime-additional-copy.ts';
import { fileValidationFailure as failure } from '../../file-validation-failure.ts';
import { formatFileFailureMessage } from '../../format-file-failure.ts';

type WarpField = 'marker outer' | 'marker source' | 'groove offset';
export function parseAudioWarpRational(value: string, name: WarpField): RationalInput {
	const token = value.trim(), match = /^(-?\d+)(?:\/(\d+))?$/u.exec(token);
	const field: LocalizedPresentationMessage = name === 'groove offset'
		? { key: 'audioWarpGrooveOffsets', fallback: 'Groove offsets (maximum 128, comma-separated fractions)' }
		: { key: name === 'marker outer' ? 'ui.fileValidation.audioWarpOuter' : 'ui.fileValidation.audioWarpSource',
			fallback: name === 'marker outer' ? FILE_VALIDATION_COPY.audioWarpOuter : FILE_VALIDATION_COPY.audioWarpSource };
	if (!match) throw failure(new TypeError(`Invalid ${name}: ${token}.`), 'editor-input', 'warp-fraction', 'audioWarpFraction', { field, value: token });
	const num = Number(match[1]), den = Number(match[2] ?? 1);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den < 1) {
		throw failure(new RangeError(`Invalid ${name}: ${token}.`), 'editor-input', 'warp-fraction', 'audioWarpFraction', { field, value: token });
	}
	return Object.freeze({ num, den });
}
export function parseAudioWarpGrooveOffsets(value: string): readonly RationalInput[] {
	const tokens = value.split(',').map(token => token.trim()).filter(Boolean);
	if (tokens.length < 1 || tokens.length > 128) throw failure(new RangeError('A groove template requires 1 to 128 offsets.'), 'editor-input', 'groove-size', 'audioWarpGrooveSize', { minimum: 1, maximum: 128 });
	return Object.freeze(tokens.map(token => parseAudioWarpRational(token, 'groove offset')));
}
const RETIME_FIELDS = { 'freeze source frame': 'videoRetimeSourceFrame', 'start velocity': 'videoRetimeStartVelocity',
	'end velocity': 'videoRetimeEndVelocity', 'source start frame': 'videoRetimeSourceStartFrame' } as const;
export function parseVideoRetimeRational(value: string, name: keyof typeof RETIME_FIELDS): Readonly<{ num: number; den: number }> {
	const parts = value.trim().split('/'), num = Number(parts[0]), den = parts.length === 2 ? Number(parts[1]) : 1;
	if (parts.length < 1 || parts.length > 2 || parts.some(part => !part.trim())
		|| !Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0 || Object.is(num, -0)) {
		const key = RETIME_FIELDS[name];
		throw failure(new RangeError(`${name} must be a safe-integer fraction with a positive denominator.`), 'editor-input', 'retime-fraction', 'videoRetimeFraction',
			{ field: { key: `ui.videoRetime.${key}`, fallback: VIDEO_RETIME_ADDITIONAL_COPY[key] } });
	}
	return Object.freeze({ num, den });
}
export function parseFinishingNoiseProfile(value: string): Readonly<Record<string, unknown>> {
	let parsed: unknown;
	try { parsed = JSON.parse(value) as unknown; } catch (cause) {
		throw failure(new SyntaxError('The noise profile must be valid JSON.', { cause }), 'editor-input', 'noise-profile-json', 'noiseProfileJson');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw failure(new TypeError('The noise profile must be a JSON object.'), 'editor-input', 'noise-profile-object', 'noiseProfileInvalid');
	return parsed as Readonly<Record<string, unknown>>;
}
export function noiseProfileFailure(error: unknown): unknown {
	return error instanceof Error && !formatFileFailureMessage(error) ? failure(error, 'editor-input', 'noise-profile-settings', 'noiseProfileInvalid') : error;
}
export function visualAuthoringFailure(error: unknown): unknown {
	return error instanceof Error && !formatFileFailureMessage(error) ? failure(error, 'editor-input', 'visual-authoring-operation', 'visualAuthoringOperation') : error;
}
