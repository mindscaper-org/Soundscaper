/* SPDX-License-Identifier: AGPL-3.0-only */

export type AcxCheckStatus = 'pass' | 'fail' | 'unmeasured';
export type AcxCheckId = 'peak' | 'rms' | 'noiseFloor' | 'sampleRate' | 'duration' | 'channels';

export interface AcxComplianceCheck {
	readonly id: AcxCheckId;
	readonly value: number | null;
	readonly status: AcxCheckStatus;
}

/** Audio limits from https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements. */
export function createAcxComplianceReport(measurement: unknown) {
	const source = measurement && typeof measurement === 'object' ? measurement as Record<string, unknown> : {};
	const number = (key: string): number | null => typeof source[key] === 'number' && Number.isFinite(source[key]) ? source[key] : null;
	const frames = number('frameCount');
	const rate = number('sampleRate');
	const hasAudio = frames !== null && Number.isSafeInteger(frames) && frames > 0 && rate !== null && rate > 0;
	const check = (id: AcxCheckId, value: number | null, accepts: (value: number) => boolean): AcxComplianceCheck => Object.freeze({
		id, value: hasAudio ? value : null,
		status: !hasAudio || value === null ? 'unmeasured' : accepts(value) ? 'pass' : 'fail',
	});
	const checks = Object.freeze([
		check('peak', number('peakDbfs'), value => value <= -3),
		check('rms', number('rmsDbfs'), value => value >= -23 && value <= -18),
		check('noiseFloor', number('noiseFloorDbfs'), value => value <= -60),
		check('sampleRate', rate, value => value === 44_100),
		check('duration', hasAudio ? frames / rate : null, value => value <= 7_200),
		check('channels', number('channelCount'), value => value === 1 || value === 2),
	]);
	const status: AcxCheckStatus = checks.some(item => item.status === 'fail') ? 'fail'
		: checks.some(item => item.status === 'unmeasured') ? 'unmeasured' : 'pass';
	return Object.freeze({ schemaVersion: 1, type: 'acx-compliance', status, checks });
}
