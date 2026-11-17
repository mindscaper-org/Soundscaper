/* SPDX-License-Identifier: AGPL-3.0-only */

import { rationalFromDouble } from './dawproject-format.ts';
import type { Rational } from './timeline-time.ts';
import { timelineImportIssue } from './timeline-interchange-types.ts';
import type { DeliveryReportItem } from './delivery-report.ts';
import type { ReaperEntry } from './reaper-chunks.ts';

export type ReaperReport = (code: string, message: string, disposition?: 'omitted' | 'converted') => void;

export function reaperReport(issues: DeliveryReportItem[]): ReaperReport {
	const reported = new Set<string>();
	return (code, message, disposition = 'omitted') => {
		if (reported.has(code)) return;
		reported.add(code); issues.push(timelineImportIssue('reaper', code, message, disposition));
	};
}

export function reaperNumber(value: string | undefined, fallback = 0): number {
	if (value === undefined) return fallback;
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value) || !Number.isFinite(Number(value))) {
		throw new RangeError('REAPER controls must be finite numbers.');
	}
	return Number(value);
}

export function reaperTime(value: string | undefined, required = false): Rational {
	if (required && value === undefined) throw new SyntaxError('REAPER item position and length are required.');
	const seconds = reaperNumber(value);
	if (seconds < 0 || seconds > 1e9) throw new RangeError('REAPER time is outside the supported range.');
	return rationalFromDouble(seconds, Math.min(1_000_000_000, Math.floor(Number.MAX_SAFE_INTEGER / Math.max(1, seconds))));
}

export function reportReaperProcessing(entries: readonly ReaperEntry[], report: ReaperReport): void {
	if (entries.some(entry => /^(?:FXCHAIN|FXCHAIN_REC|TAKEFX|MASTERFXLIST)$/u.test(entry.name))) {
		report('processing-omitted', 'REAPER plug-ins and their processing are not imported. Render processed media in REAPER when required.');
	}
	if (entries.some(entry => entry.kind === 'chunk' && /ENV/u.test(entry.name))) {
		report('automation-omitted', 'REAPER automation, take envelopes and tempo changes are not imported; review affected levels and timing.');
	}
}
