/* SPDX-License-Identifier: AGPL-3.0-only */
import type { LocalAssistanceInputClaim } from './local-assistance-bridge.ts';
export interface KeyingSourceDecodeRequest {
	readonly contractVersion: 1; readonly jobId: string; readonly source: LocalAssistanceInputClaim;
	readonly width: number; readonly height: number; readonly frameCount: number;
	readonly frameRate: Readonly<{ num: number; den: number }>;
}
export interface KeyingSourceDecodeResult {
	readonly contractVersion: 1; readonly jobId: string; readonly sourceSha256: string;
	readonly width: number; readonly height: number; readonly frameCount: number; readonly byteLength: number;
}
export interface KeyingSourceDecodeBridge {
	decodeSource(request: KeyingSourceDecodeRequest): Promise<KeyingSourceDecodeResult>;
	readDecodedSource(request: Readonly<{ jobId: string; offset: number; maximumBytes: number }>): Promise<Uint8Array>;
}
export function lazyKeyingSourceDecodeBridge(value: unknown): Partial<KeyingSourceDecodeBridge> {
	if (!value || typeof value !== 'object') return {};
	const source = value as Partial<KeyingSourceDecodeBridge>;
	const decode = source.decodeSource, read = source.readDecodedSource;
	if (typeof decode !== 'function' || typeof read !== 'function') return {};
	return Object.freeze({ async decodeSource(request: KeyingSourceDecodeRequest) {
		const result = await decode.call(value, request);
		if (!result || Reflect.ownKeys(result).length !== 7 || result.contractVersion !== 1 || result.jobId !== request.jobId
			|| result.sourceSha256 !== request.source.sha256 || result.width !== request.width || result.height !== request.height
			|| result.frameCount !== request.frameCount || result.byteLength !== request.width * request.height * request.frameCount * 4) {
			throw new Error('Native source decoding lost its exact original source binding.');
		}
		return Object.freeze({ ...result });
	}, async readDecodedSource(request: Readonly<{ jobId: string; offset: number; maximumBytes: number }>) {
		const bytes = await read.call(value, request);
		if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > request.maximumBytes) throw new Error('Invalid native source decode bytes.');
		return Uint8Array.from(bytes);
	} });
}
