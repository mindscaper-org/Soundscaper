/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/foundation/closed-domain-value.ts';
import { planPixelFrameV1, type PixelFrameDescriptorV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';
import { fitPixelSizeV1 } from '../common/editor/imaging/pixel-frame-resize-v1.ts';
import { readPhotoLibraryRawFrameRequestCurrentV1 as frame, readPhotoLibraryRawPreviewRequestCurrentV1 as preview,
	type PhotoLibraryRawFrameRequestCurrentV1 as FrameRequest, type PhotoLibraryRawPreviewRequestCurrentV1 as PreviewRequest,
	type PhotoLibraryRawDecoderCurrentV1 as Decoder } from './controller/photo-library-raw-source-current-v1.ts';
export interface DesktopPhotoRawInputCurrentV1 { readonly inputId: string; readonly byteLength: number; readonly contentSha256: string }
export type DesktopPhotoRawRequestCurrentV1 = Readonly<{ kind: 'input'; request: Readonly<DesktopPhotoRawInputCurrentV1> }> | Readonly<{ kind: 'frame'; request: Readonly<FrameRequest> }> | Readonly<{ kind: 'preview'; request: Readonly<PreviewRequest> }>;
export interface DesktopPhotoRawTicketCurrentV1 {
	readonly schemaVersion: 1; readonly id: string; readonly byteLength: number;
	readonly descriptor: Readonly<PixelFrameDescriptorV1>; readonly decoder: Readonly<Decoder>;
	readonly profile: FrameRequest['profile']; readonly rawFlip: number; readonly exposureScale: number; readonly contentSha256: string;
	readonly input?: Readonly<{ byteLength: number; contentSha256: string }>;
	readonly source?: Readonly<{ width: number; height: number }>;
	readonly recipe?: Readonly<{ id: 'lightscaper.native-original-preview.rgba8-nearest'; version: 1 }>;
}
export type DesktopPhotoRawOpenCurrentV1 = Readonly<{ outcome: 'ready'; ticket: Readonly<DesktopPhotoRawTicketCurrentV1> }>
	| Readonly<{ outcome: 'web-fallback'; reason: 'native-unavailable' | 'unsupported-representation' }>;
export type DesktopPhotoRawRetirementCurrentV1 = undefined | Readonly<{ retired: true; sourceFailed: true }>;
export interface DesktopPhotoRawTransportCurrentV1 {
	open(request: DesktopPhotoRawRequestCurrentV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<DesktopPhotoRawOpenCurrentV1>;
	read(ticket: Readonly<{ id: string }>, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
	close(ticket: Readonly<{ id: string }>): Promise<DesktopPhotoRawRetirementCurrentV1>;
}
export const DESKTOP_PHOTO_RAW_LIMITS_CURRENT_V1 = Object.freeze({ maximumOutputBytes: 268_435_456, maximumRangeBytes: 1_048_576 });
export function readDesktopPhotoRawRequestCurrentV1(value: unknown): DesktopPhotoRawRequestCurrentV1 {
	const input = record(value, 'native RAW output request', ['kind', 'request']), kind = field(input, 'kind', 'native RAW output request');
	if (kind === 'input') return Object.freeze({ kind, request: readDesktopPhotoRawInputCurrentV1(field(input, 'request', 'native RAW input request')) });
	if (kind !== 'frame' && kind !== 'preview') throw new TypeError('Unknown native RAW output purpose.');
	return kind === 'frame' ? Object.freeze({ kind, request: frame(field(input, 'request', 'native RAW output request')) }) : Object.freeze({ kind, request: preview(field(input, 'request', 'native RAW output request')) });
}
export function readDesktopPhotoRawInputCurrentV1(value: unknown): Readonly<DesktopPhotoRawInputCurrentV1> {
	const input = record(value, 'native RAW input request', ['inputId', 'byteLength', 'contentSha256']);
	const inputId = readDesktopPhotoRawTicketIdCurrentV1({ id: field(input, 'inputId', 'native RAW input request') });
	const byteLength = field(input, 'byteLength', 'native RAW input request'), contentSha256 = field(input, 'contentSha256', 'native RAW input request');
	if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 67_108_864 || typeof contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(contentSha256)) throw new RangeError('Native RAW input facts exceed their fixed purpose.');
	return Object.freeze({ inputId, byteLength, contentSha256 });
}
export function readDesktopPhotoRawTicketIdCurrentV1(value: unknown): string {
	const input = record(value, 'native RAW output identity', ['id']), id = field(input, 'id', 'native RAW output identity');
	if (typeof id !== 'string' || !/^[0-9a-f]{64}$/u.test(id)) throw new TypeError('Native RAW requires its exact private output identity.'); return id;
}
export function readDesktopPhotoRawTicketCurrentV1(value: unknown, bound: DesktopPhotoRawRequestCurrentV1): Readonly<DesktopPhotoRawTicketCurrentV1> {
	const fields = ['schemaVersion', 'id', 'byteLength', 'descriptor', 'decoder', 'profile', 'rawFlip', 'exposureScale', 'contentSha256'];
	const input = record(value, 'native RAW output ticket', bound.kind === 'preview' ? [...fields, 'source', 'recipe'] : bound.kind === 'input' ? [...fields, 'input'] : fields);
	const get = (key: string) => field(input, key, 'native RAW output ticket');
	if (get('schemaVersion') !== 1) throw new TypeError('Unknown native RAW output ticket version.');
	const id = readDesktopPhotoRawTicketIdCurrentV1({ id: get('id') }), profile = bound.kind === 'frame' ? bound.request.profile : 'canonical';
	const original = bound.kind === 'input' ? undefined : bound.request.original, side = bound.kind === 'preview' ? bound.request.tier === 'thumbnail' ? 512 : 2048 : null;
	const size = original === undefined ? undefined : side === null ? { width: original.width, height: original.height } : fitPixelSizeV1(original.width, original.height, side, side);
	const plan = planPixelFrameV1(get('descriptor'), { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: DESKTOP_PHOTO_RAW_LIMITS_CURRENT_V1.maximumOutputBytes });
	const descriptor = plan.descriptor, sampleFormat = side === null ? profile === 'canonical' ? 'unorm16' : 'float32' : 'unorm8';
	if (size !== undefined && (descriptor.width !== size.width || descriptor.height !== size.height) || descriptor.sampleFormat !== sampleFormat || descriptor.primaries !== 'srgb'
		|| descriptor.transfer !== (side === null ? 'linear' : 'srgb') || get('byteLength') !== plan.byteLength || get('profile') !== profile) throw new RangeError('Native RAW output geometry or fixed profile changed.');
	const rawFlip = get('rawFlip'), exposureScale = get('exposureScale'), contentSha256 = get('contentSha256');
	if (typeof rawFlip !== 'number' || !Number.isSafeInteger(rawFlip) || rawFlip < 0 || rawFlip > 7 || typeof exposureScale !== 'number' || !Number.isFinite(exposureScale)
		|| exposureScale < 1 || exposureScale > 65536 || profile === 'canonical' && exposureScale !== 1 || typeof contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(contentSha256)) throw new RangeError('Native RAW output facts changed.');
	const decoder: Decoder = { schemaVersion: 1, engine: 'lightscaper-libraw-native', engineVersion: 1, upstream: '0.22.2',
		profile: profile === 'canonical' ? 'neutral-linear-srgb16' : profile === 'linear-headroom-v1' ? 'linear-headroom-f32' : 'highlight-recovery-f32', profileVersion: 1 };
	const selected = record(get('decoder'), 'native RAW output decoder', Object.keys(decoder));
	for (const [key, expected] of Object.entries(decoder)) if (field(selected, key, 'native RAW output decoder') !== expected) throw new TypeError('Native RAW decoder provenance changed.');
	const result = { schemaVersion: 1 as const, id, byteLength: plan.byteLength, descriptor, decoder: Object.freeze(decoder), profile, rawFlip, exposureScale, contentSha256 };
	if (bound.kind === 'frame') return Object.freeze(result);
	if (bound.kind === 'input') {
		const facts = record(get('input'), 'native RAW completed input', ['byteLength', 'contentSha256']);
		if (field(facts, 'byteLength', 'native RAW completed input') !== bound.request.byteLength || field(facts, 'contentSha256', 'native RAW completed input') !== bound.request.contentSha256) throw new Error('Native RAW actual completed input differs from its requested bytes.');
		return Object.freeze({ ...result, input: Object.freeze({ byteLength: bound.request.byteLength, contentSha256: bound.request.contentSha256 }) });
	}
	if (!original) throw new Error('Native RAW preview requires an Original.');
	const source = record(get('source'), 'native RAW preview source', ['width', 'height']), recipe = record(get('recipe'), 'native RAW preview recipe', ['id', 'version']);
	if (field(source, 'width', 'native RAW preview source') !== original.width || field(source, 'height', 'native RAW preview source') !== original.height
		|| field(recipe, 'id', 'native RAW preview recipe') !== 'lightscaper.native-original-preview.rgba8-nearest' || field(recipe, 'version', 'native RAW preview recipe') !== 1) throw new RangeError('Native RAW preview source or recipe changed.');
	return Object.freeze({ ...result, source: Object.freeze({ width: original.width, height: original.height }), recipe: Object.freeze({ id: 'lightscaper.native-original-preview.rgba8-nearest', version: 1 }) });
}
export function readDesktopPhotoRawOpenCurrentV1(value: unknown, request: DesktopPhotoRawRequestCurrentV1): DesktopPhotoRawOpenCurrentV1 {
	const input = record(value, 'native RAW output response', ['outcome', 'ticket', 'reason'], ['outcome']), outcome = field(input, 'outcome', 'native RAW output response');
	if (outcome === 'ready') { record(value, 'native RAW ready response', ['outcome', 'ticket']); return Object.freeze({ outcome, ticket: readDesktopPhotoRawTicketCurrentV1(field(input, 'ticket', 'native RAW output response'), request) }); }
	record(value, 'native RAW fallback response', ['outcome', 'reason']); const reason = field(input, 'reason', 'native RAW output response');
	if (outcome !== 'web-fallback' || reason !== 'native-unavailable' && reason !== 'unsupported-representation') throw new TypeError('Invalid native RAW fallback response.');
	return Object.freeze({ outcome, reason });
}

/** A known operation failure and actual cleanup have independent outcomes. */
export function readDesktopPhotoRawRetirementCurrentV1(value: unknown): DesktopPhotoRawRetirementCurrentV1 {
	if (value === undefined) return undefined;
	const input = record(value, 'native RAW completed retirement', ['retired', 'sourceFailed']);
	if (field(input, 'retired', 'native RAW completed retirement') !== true || field(input, 'sourceFailed', 'native RAW completed retirement') !== true) throw new TypeError('Native RAW retirement receipt is invalid.');
	return Object.freeze({ retired: true, sourceFailed: true });
}
