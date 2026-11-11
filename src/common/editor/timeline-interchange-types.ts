/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Rational } from './timeline-time.ts';
import type { DeliveryReportItem } from './delivery-report.ts';

export type TimelineInterchangeFormat = 'edl' | 'otio' | 'fcpxml' | 'omf' | 'aaf';
export interface TimelineInterchangeClip {
	readonly id: string;
	readonly name: string;
	readonly mediaId: string;
	/** Exact seconds, relative to sequence origin. */
	readonly start: Rational;
	readonly duration: Rational;
	readonly sourceStart: Rational;
}
export interface TimelineInterchangeTrack {
	readonly id: string;
	readonly name: string;
	readonly kind: 'audio' | 'video';
	readonly clips: readonly TimelineInterchangeClip[];
	readonly mute?: boolean;
}
export interface TimelineInterchangeMedia {
	readonly id: string;
	readonly path: string;
	readonly name: string;
	readonly kind: 'audio' | 'video';
	readonly rate?: Rational;
	readonly duration?: Rational;
	readonly width?: number;
	readonly height?: number;
	readonly blob?: Blob;
	/** Original filenames retained when the interchange URL is a managed key. */
	readonly aliases?: readonly string[];
}
export interface TimelineInterchangeDocument {
	readonly format: TimelineInterchangeFormat;
	readonly title: string;
	readonly sampleRate: number;
	readonly rate: Rational;
	readonly dropFrame: boolean;
	readonly startFrameCount: number;
	readonly tracks: readonly TimelineInterchangeTrack[];
	readonly media: readonly TimelineInterchangeMedia[];
	readonly issues: readonly DeliveryReportItem[];
}

export function timelineImportIssue(format: TimelineInterchangeFormat, code: string, message: string,
	disposition: DeliveryReportItem['disposition'] = 'omitted', data: Readonly<Record<string, unknown>> = {}): DeliveryReportItem {
	return { code: `${format}.${code}`, disposition, severity: disposition === 'preserved' ? 'info' : 'warning', scope: {}, data, message };
}

export const TIMELINE_INTERCHANGE_MAXIMUM_BYTES = 64 * 1024 * 1024;
export const TIMELINE_INTERCHANGE_MAXIMUM_ITEMS = 100000;
export const TIMELINE_INTERCHANGE_MAXIMUM_DEPTH = 64;

/** Decode only a basename; original URLs remain opaque media references. */
export function timelineInterchangeMediaName(path: string, fallback = ''): string {
	const name = path.split(/[\\/]/u).at(-1)?.split(/[?#]/u)[0] || fallback;
	try { return decodeURIComponent(name); } catch { return name; }
}
