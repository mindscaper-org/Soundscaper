/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTrackDisplayMode, type TrackDisplayMode } from '../../../../track-display-mode.ts';

export interface MacroViewportPosition { readonly scrollX: number; readonly scrollY: number }
export interface MacroViewportPort {
	readonly read: () => MacroViewportPosition;
	readonly write: (position: MacroViewportPosition, assertCurrent: () => void) => Promise<void>;
}

interface ViewTrack {
	readonly id: string;
	readonly type?: string;
	readonly height?: number;
	readonly hidden?: boolean;
	readonly displayMode?: string;
}

interface Runtime {
	readonly getProject: () => { readonly id: string; readonly tracks: readonly ViewTrack[] } | null;
	readonly state: { readonly pixelsPerSecond?: number; readonly autoFitTrackHeight?: boolean; readonly timelineView?: string; readonly allowBelowProjectFitZoom?: boolean };
	readonly setZoom: (value: number, allowBelowProjectFit: boolean) => unknown;
	readonly setView: (value: TrackDisplayMode) => unknown;
	readonly setAutoFitTrackHeight: (value: boolean) => unknown;
	readonly zoom: (action: 'in' | 'out' | 'fit') => unknown;
	readonly updateTracks: (updates: readonly { readonly id: string; readonly changes: Readonly<Record<string, unknown>> }[]) => unknown;
}

/** Macro-only admission; mutations still use the existing timeline and document owners. */
export function createMacroViewService(runtime: Runtime) {
	let viewport: { readonly projectId: string; readonly port: MacroViewportPort } | null = null;
	let restorationOwner: object | null = null;
	return Object.freeze({ snapshot, set, zoom, bindViewport, captureTransient, restoreTransient });

	function bindViewport(port: MacroViewportPort): () => void {
		const binding = { projectId: project().id, port };
		viewport = binding;
		return () => { if (viewport === binding) viewport = null; };
	}

	function project() {
		const current = runtime.getProject();
		if (!current) throw new Error('A project is required to control the view.');
		return current;
	}

	function snapshot() {
		const current = project();
		return {
			projectId: current.id,
			pixelsPerSecond: runtime.state.pixelsPerSecond ?? 120,
			autoFitTrackHeight: runtime.state.autoFitTrackHeight !== false,
			view: runtime.state.timelineView ?? 'waveform',
			...(viewport?.projectId === current.id ? viewport.port.read() : {}),
			tracks: current.tracks.map(track => ({
				id: track.id, height: track.height ?? 114,
				...(track.type === 'video' ? { hidden: track.hidden === true } : {}),
				...(track.type === 'audio' ? { displayMode: track.displayMode ?? runtime.state.timelineView ?? 'waveform' } : {}),
			})),
		};
	}

	async function set(value: unknown, assertCurrent: () => void = () => undefined) {
		const request = object(value);
		keys(request, ['projectId', 'pixelsPerSecond', 'autoFitTrackHeight', 'view', 'scrollX', 'scrollY', 'tracks']);
		const current = project();
		if ('projectId' in request && request.projectId !== current.id) throw new RangeError('The remembered view belongs to another project.');
		if ('pixelsPerSecond' in request) number(request.pixelsPerSecond, 'pixelsPerSecond', Number.MIN_VALUE);
		if ('autoFitTrackHeight' in request) boolean(request.autoFitTrackHeight, 'autoFitTrackHeight');
		if ('view' in request && !isTrackDisplayMode(request.view)) throw new RangeError('Unsupported timeline view.');
		for (const key of ['scrollX', 'scrollY']) if (key in request) number(request[key], key, 0);
		const updates = trackUpdates(request.tracks, current.tracks);
		const binding = viewport?.projectId === current.id ? viewport : null;
		const scrolling = 'scrollX' in request || 'scrollY' in request;
		if (scrolling && !binding) throw new Error('The timeline viewport is unavailable.');
		assertCurrent();
		if (updates.length) runtime.updateTracks(updates);
		applyTransient(request);
		if (!('autoFitTrackHeight' in request) && updates.some(update => 'height' in update.changes)) runtime.setAutoFitTrackHeight(false);
		if (binding) await writeScroll(binding, request, assertCurrent);
		assertCurrent();
		return snapshot();
	}

	async function zoom(action: unknown, assertCurrent: () => void = () => undefined) {
		if (action !== 'in' && action !== 'out' && action !== 'fit') throw new RangeError('Zoom must be in, out, or fit.');
		const binding = viewport?.projectId === project().id ? viewport : null;
		assertCurrent();
		runtime.zoom(action);
		if (binding) await writeScroll(binding, {}, assertCurrent);
		assertCurrent();
		return snapshot();
	}

	function captureTransient() {
		const owner = {};
		restorationOwner = owner;
		return { owner, view: snapshot(), allowBelowProjectFitZoom: runtime.state.allowBelowProjectFitZoom === true };
	}

	/** History restores track fields; transient view state needs its own compensation. */
	async function restoreTransient(saved: ReturnType<typeof captureTransient>): Promise<void> {
		if (restorationOwner !== saved.owner || project().id !== saved.view.projectId) return;
		applyTransient(saved.view, saved.allowBelowProjectFitZoom);
		const binding = viewport?.projectId === saved.view.projectId ? viewport : null;
		if (binding && 'scrollX' in saved.view && 'scrollY' in saved.view) await writeScroll(binding, saved.view, () => {
			if (restorationOwner !== saved.owner) throw new DOMException('A newer program owns the timeline view.', 'AbortError');
		});
	}

	function applyTransient(request: Readonly<Record<string, unknown>>, allowBelowProjectFit = true): void {
		if ('pixelsPerSecond' in request) runtime.setZoom(request.pixelsPerSecond as number, allowBelowProjectFit);
		if ('view' in request) runtime.setView(request.view as TrackDisplayMode);
		if ('autoFitTrackHeight' in request) runtime.setAutoFitTrackHeight(request.autoFitTrackHeight as boolean);
	}

	async function writeScroll(binding: NonNullable<typeof viewport>, request: Readonly<Record<string, unknown>>, assertCurrent: () => void): Promise<void> {
		const previous = binding.port.read();
		await binding.port.write({ scrollX: request.scrollX as number ?? previous.scrollX, scrollY: request.scrollY as number ?? previous.scrollY }, () => {
			assertCurrent();
			if (viewport !== binding || project().id !== binding.projectId) throw new DOMException('The timeline viewport changed.', 'AbortError');
		});
	}
}

function trackUpdates(value: unknown, tracks: readonly ViewTrack[]) {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new TypeError('View tracks must be an array.');
	const seen = new Set<string>();
	return value.map((entry: unknown) => {
		const item = object(entry);
		keys(item, ['id', 'height', 'hidden', 'displayMode']);
		const track = tracks.find(candidate => candidate.id === item.id);
		if (!track || seen.has(track.id)) throw new RangeError('View tracks must name existing, unique tracks.');
		seen.add(track.id);
		const { id: _id, ...changes } = item;
		if ('height' in changes) {
			const height = number(changes.height, 'height', 40);
			if (!Number.isSafeInteger(height)) throw new RangeError('Track height must be a safe integer of at least 40.');
		}
		if ('hidden' in changes) {
			boolean(changes.hidden, 'hidden');
			if (track.type !== 'video') throw new RangeError('Only video tracks support hidden.');
		}
		if ('displayMode' in changes && (track.type !== 'audio' || !isTrackDisplayMode(changes.displayMode))) throw new RangeError('Unsupported audio track display mode.');
		return { id: track.id, changes };
	});
}

function object(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A view needs an options object.');
	return value as Readonly<Record<string, unknown>>;
}

function keys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
	if (Object.keys(value).some(key => !allowed.includes(key))) throw new RangeError('Unknown view option.');
}

function number(value: unknown, name: string, minimum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > Number.MAX_SAFE_INTEGER) throw new RangeError(`${name} must be a finite number of at least ${minimum}.`);
	return value;
}

function boolean(value: unknown, name: string): void {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
}
