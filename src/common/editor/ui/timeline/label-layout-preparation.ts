/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimelineLabelMetrics, TimelineLabelRange } from './label-design-geometry.ts';

interface PreparedTimelineLabels {
	readonly sorted: readonly TimelineLabelRange[];
	readonly uniqueIds: boolean;
	readonly heights: Map<string, number>;
}

interface CachedTimelineLabels extends PreparedTimelineLabels {
	readonly owner: WeakRef<readonly TimelineLabelRange[]>;
}

// Geometry follows the lifetime of its source array; the LRU holds only weak
// owners and counts so closed projects cannot leave large label metadata alive.
const MAXIMUM_PREPARED_LABELS = 65_536;
const MAXIMUM_PREPARED_ARRAYS = 32;
const MAXIMUM_TEXT_WIDTHS = 65_536;
const MAXIMUM_TEXT_CHARACTERS = 1_048_576;
const prepared = new WeakMap<readonly TimelineLabelRange[], CachedTimelineLabels>();
const immutableArrays = new WeakSet<readonly TimelineLabelRange[]>();
const preparedOwners = new Map<WeakRef<readonly TimelineLabelRange[]>, number>();
const widths = new Map<string, number>();
const listeners = new Set<() => void>();
let preparedLabelCount = 0;
let textCharacters = 0;
let font = '';
let fontRevision = 0;
let ownerDocument: Document | null = null;
let ownerFonts: FontFaceSet | undefined;
let measureContext: CanvasRenderingContext2D | null | undefined;

function invalidateFont(): void {
	fontRevision++;
	widths.clear(); textCharacters = 0; font = '';
	for (const owner of preparedOwners.keys()) {
		const labels = owner.deref();
		if (labels) prepared.get(labels)?.heights.clear();
	}
	for (const listener of listeners) listener();
}

function resolveDocument(): void {
	const current = typeof document === 'undefined' ? null : document;
	if (ownerDocument === current && ownerFonts === current?.fonts) return;
	ownerFonts?.removeEventListener('loadingdone', invalidateFont);
	ownerFonts?.removeEventListener('loadingerror', invalidateFont);
	ownerDocument = current;
	ownerFonts = current?.fonts;
	measureContext = undefined;
	ownerFonts?.addEventListener('loadingdone', invalidateFont);
	ownerFonts?.addEventListener('loadingerror', invalidateFont);
	invalidateFont();
}

export function timelineLabelFontRevision(): number {
	resolveDocument();
	return fontRevision;
}

export function subscribeTimelineLabelFonts(listener: () => void): () => void {
	resolveDocument();
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

export function pointLabelWidth(title: string, metrics: TimelineLabelMetrics): number {
	resolveDocument();
	if (measureContext === undefined) measureContext = ownerDocument?.createElement('canvas').getContext?.('2d') ?? null;
	const nextFont = `500 ${String(metrics.fontSizePx)}px Inter, sans-serif`;
	if (font !== nextFont) {
		font = nextFont; widths.clear(); textCharacters = 0;
		if (measureContext) measureContext.font = font;
	}
	let textWidth = widths.get(title);
	if (textWidth === undefined) {
		textWidth = measureContext?.measureText(title).width ?? title.length * metrics.fontSizePx * 0.6;
		if (title.length <= MAXIMUM_TEXT_CHARACTERS) {
			while (widths.size >= MAXIMUM_TEXT_WIDTHS || textCharacters + title.length > MAXIMUM_TEXT_CHARACTERS) {
				const oldest = widths.keys().next().value;
				if (oldest === undefined) break;
				widths.delete(oldest); textCharacters -= oldest.length;
			}
			widths.set(title, textWidth); textCharacters += title.length;
		}
	}
	return Math.max(metrics.minPointWidth, Math.min(metrics.maxPointWidth, Math.ceil(textWidth) + metrics.padX * 2));
}

/** Frozen accessors and frozen containers with mutable members are not immutable data. */
function immutableLabel(label: TimelineLabelRange): boolean {
	if (!label || typeof label !== 'object' || !Object.isFrozen(label)) return false;
	for (const field of ['id', 'title', 'startFrame', 'endFrame'] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(label, field);
		if (!descriptor) { if (field === 'title' && !('title' in label)) continue; return false; }
		if (!('value' in descriptor)) return false;
		if (field === 'id' ? typeof descriptor.value !== 'string'
			: field === 'title' ? descriptor.value !== undefined && typeof descriptor.value !== 'string'
				: typeof descriptor.value !== 'number') return false;
	}
	return true;
}

function immutableArray(labels: readonly TimelineLabelRange[]): boolean {
	if (immutableArrays.has(labels)) return true;
	if (!canonicalFrozenArray(labels)) return false;
	for (let index = 0; index < labels.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(labels, index);
		if (!descriptor || !('value' in descriptor) || !immutableLabel(descriptor.value as TimelineLabelRange)) return false;
	}
	immutableArrays.add(labels);
	return true;
}

function canonicalFrozenArray(labels: readonly TimelineLabelRange[]): boolean {
	return Object.isFrozen(labels) && Object.getPrototypeOf(labels) === Array.prototype && !Object.hasOwn(labels, Symbol.iterator);
}

/** Detached snapshots can replace objects while preserving their immutable geometry. */
export function sameImmutableTimelineLabels(left: readonly TimelineLabelRange[], right: readonly TimelineLabelRange[]): boolean {
	if (!immutableArrays.has(left) || !canonicalFrozenArray(right) || left.length !== right.length) return false;
	if (left === right) return true;
	for (let index = 0; index < left.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(right, index);
		if (!descriptor || !('value' in descriptor)) return false;
		const previous = left[index]!, current = descriptor.value as TimelineLabelRange;
		if (previous === current) continue;
		if (!immutableLabel(current) || !Object.is(previous.id, current.id) || !Object.is(previous.title, current.title)
			|| !Object.is(previous.startFrame, current.startFrame) || !Object.is(previous.endFrame, current.endFrame)) return false;
	}
	immutableArrays.add(right);
	return true;
}

export function prepareTimelineLabels(labels: readonly TimelineLabelRange[]): PreparedTimelineLabels {
	const previous = prepared.get(labels);
	if (previous) {
		preparedOwners.delete(previous.owner); preparedOwners.set(previous.owner, labels.length);
		return previous;
	}
	const sorted = [...labels].sort((left, right) => left.startFrame - right.startFrame);
	const entry = { sorted, uniqueIds: new Set(sorted.map(label => label.id)).size === sorted.length, heights: new Map<string, number>() };
	if (labels.length <= MAXIMUM_PREPARED_LABELS && immutableArray(labels)) {
		while (preparedOwners.size >= MAXIMUM_PREPARED_ARRAYS || preparedLabelCount + labels.length > MAXIMUM_PREPARED_LABELS) {
			const oldest = preparedOwners.entries().next().value;
			if (oldest === undefined) break;
			const [owner, count] = oldest;
			const retired = owner.deref();
			if (retired) prepared.delete(retired);
			preparedOwners.delete(owner); preparedLabelCount -= count;
		}
		const owner = new WeakRef(labels);
		prepared.set(labels, { ...entry, owner }); preparedOwners.set(owner, labels.length); preparedLabelCount += labels.length;
	}
	return entry;
}
