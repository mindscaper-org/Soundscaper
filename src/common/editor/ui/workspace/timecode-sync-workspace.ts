/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect } from 'react';
import type { EnginePublicApi } from '../../engine/public-api.ts';
import type { TimecodeSyncSession, TimecodeSyncIo } from '../../controller/transport/timecode-sync-session.ts';

export interface TimecodeWorkspaceSnapshot {
	readonly transportState?: string;
	readonly recordingStarting?: boolean;
	readonly recordingScheduling?: boolean;
	readonly scheduledRecording?: unknown;
	readonly projectActivationPending?: boolean;
	readonly projectAdministrationPending?: boolean;
	readonly phase?: string;
	readonly playbackOptions?: { readonly rate?: number };
}

/** Receive starts ordinary playback, so a pending varispeed choice also blocks admission. */
export function timecodeReceiveBlocked(snapshot: TimecodeWorkspaceSnapshot,
	state: Readonly<{ playbackRate: number; cutPreview?: boolean }>, loopEnabled = false): boolean {
	return snapshot.transportState === 'recording' || snapshot.recordingStarting === true || snapshot.recordingScheduling === true
		|| Boolean(snapshot.scheduledRecording) || loopEnabled || state.playbackRate !== 1
		|| (snapshot.playbackOptions?.rate ?? 1) !== 1 || state.cutPreview === true;
}

export interface TimecodeWorkspaceController {
	readonly project: { readonly id: string; readonly sampleRate: number; readonly loop?: { readonly enabled?: boolean } } | null;
	readonly engine: Pick<EnginePublicApi, 'getState' | 'getPositionFrames'>;
	getSnapshot(): TimecodeWorkspaceSnapshot;
	readonly actions: { readonly transport: {
		seek(frame: number): unknown;
		playPause(): unknown;
		stop(): unknown;
	} };
}
export interface WorkspaceTimecodeRuntime { readonly session: TimecodeSyncSession; readonly io: TimecodeSyncIo }
const runtimes = new WeakMap<TimecodeWorkspaceController, WorkspaceTimecodeRuntime>();

/** Only the menu-opened dialog loads/constructs the controller; the workspace owns its lifetime. */
export function workspaceTimecodeRuntime(controller: TimecodeWorkspaceController, create: () => WorkspaceTimecodeRuntime): WorkspaceTimecodeRuntime {
	let runtime = runtimes.get(controller);
	if (!runtime) { runtime = create(); runtimes.set(controller, runtime); }
	return runtime;
}
export function useTimecodeSyncLifetime(controller: TimecodeWorkspaceController): void {
	useEffect(() => () => {
		const runtime = runtimes.get(controller);
		runtimes.delete(controller);
		void runtime?.session.dispose().catch((error: unknown) => { console.error('Timecode synchronization cleanup failed:', error); });
	}, [controller]);
}
