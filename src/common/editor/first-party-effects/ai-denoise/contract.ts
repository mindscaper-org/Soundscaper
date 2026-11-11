/* SPDX-License-Identifier: AGPL-3.0-only */

export const AI_DENOISE_TYPE = 'ai-denoise';
export const AI_DENOISE_RATE = 48_000;
export const AI_DENOISE_HOP = 480;
export const AI_DENOISE_LATENCY = 4096;
export const AI_DENOISE_POOL = 16;
export const AI_DENOISE_CONNECT = 'soundscaper-ai-denoise-connect-v1';
export const AI_DENOISE_IPC = 'soundscaper:v1:ai-denoise:connect';

export interface AiDenoiseRequest {
	readonly sessionId: string;
	readonly sampleRate: 48000;
	readonly channelCount: 1 | 2;
}
export interface AiDenoiseBlock {
	readonly type: 'block';
	readonly slot: number;
	readonly sequence: number;
	readonly input: Float32Array[];
	readonly output: Float32Array[];
	readonly outputFrames: number;
}
export function aiDenoiseGeometry(rate: number, channels: number): void {
	if (rate !== AI_DENOISE_RATE || channels !== 1 && channels !== 2) {
		throw new RangeError('Real-time AI denoising requires 48 kHz mono or stereo audio.');
	}
}
export function aiDenoiseRequest(value: unknown): AiDenoiseRequest {
	const row = value as Partial<AiDenoiseRequest> | null;
	if (!row || Object.keys(row).sort().join(',') !== 'channelCount,sampleRate,sessionId'
		|| typeof row.sessionId !== 'string' || !/^[a-f\d]{40}$/u.test(row.sessionId)) throw new TypeError('Invalid AI denoising session.');
	aiDenoiseGeometry(row.sampleRate as number, row.channelCount as number);
	return { sessionId: row.sessionId, sampleRate: 48000, channelCount: row.channelCount! };
}
export function aiDenoisePlanes(value: unknown, channels: number): value is Float32Array[] {
	return Array.isArray(value) && value.length === channels && value.every(plane =>
		plane instanceof Float32Array && plane.length === AI_DENOISE_HOP
		&& plane.byteOffset === 0 && plane.byteLength === plane.buffer.byteLength
		&& plane.buffer instanceof ArrayBuffer && plane.every(Number.isFinite))
		&& new Set(value.map(plane => plane.buffer)).size === channels;
}
export function aiDenoiseBlock(value: unknown, channels: number, sequence: number): AiDenoiseBlock {
	const row = value as AiDenoiseBlock | null;
	if (!row || Object.keys(row).sort().join(',') !== 'input,output,outputFrames,sequence,slot,type'
		|| row.type !== 'block' || row.sequence !== sequence || !Number.isSafeInteger(sequence) || sequence < 0
		|| !Number.isSafeInteger(row.slot) || row.slot < 0 || row.slot >= AI_DENOISE_POOL
		|| !aiDenoisePlanes(row.input, channels) || !aiDenoisePlanes(row.output, channels)
		|| new Set([...row.input, ...row.output].map(plane => plane.buffer)).size !== channels * 2
		|| row.outputFrames !== 0 && row.outputFrames !== AI_DENOISE_HOP) throw new TypeError('Invalid AI denoising block reply.');
	return row;
}
