/* SPDX-License-Identifier: AGPL-3.0-only */
export const MOTIONSCAPER_FILE_CHUNK_BYTES = 4 * 1024 * 1024;
export interface MotionRecoveredPublication {
	readonly transactionId: string; readonly publication: 'rolled-back' | 'published'; readonly byteLength: number; readonly sha256: string;
}
export interface MotionOpenFileCapability { readonly token: string; readonly name: string; readonly byteLength: number; readonly recoveredPublication?: MotionRecoveredPublication }
export interface MotionSaveFileReceipt {
	readonly name: string; readonly byteLength: number; readonly sha256: string;
	readonly publication?: 'prepared' | 'published' | 'rolled-back'; readonly transactionId?: string; readonly cleanupError?: string;
}
export interface MotionSaveFileCapability { readonly token: string; readonly recoveredPublication?: MotionRecoveredPublication }
export interface MotionDesktopFiles {
	selectOpen(): Promise<MotionOpenFileCapability | null>;
	read(request: { readonly token: string; readonly offset: number; readonly length: number }): Promise<Uint8Array>;
	release(request: { readonly token: string; readonly acknowledgeRecovery?: boolean }): Promise<void>;
	bindOpened(request: { readonly token: string; readonly projectId: string }): Promise<void>;
	beginSave(request: { readonly projectId: string; readonly suggestedName: string; readonly saveAs: boolean; readonly saveCopy?: boolean }): Promise<MotionSaveFileCapability | null>;
	write(request: { readonly token: string; readonly offset: number; readonly bytes: Uint8Array }): Promise<void>;
	commit(request: { readonly token: string; readonly byteLength: number; readonly phase?: 'prepare' | 'publish' | 'status' }): Promise<MotionSaveFileReceipt>;
	cancel(request: { readonly token: string; readonly acknowledge?: boolean }): Promise<void>;
}
export type MotionDesktopFileMethod = keyof MotionDesktopFiles;
export const MOTIONSCAPER_FILE_METHODS = Object.freeze(['selectOpen', 'read', 'release', 'bindOpened', 'beginSave', 'write', 'commit', 'cancel'] as const);
