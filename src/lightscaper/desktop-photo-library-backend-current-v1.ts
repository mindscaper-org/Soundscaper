/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopPhotoLibrarySessionClientTransportCurrentV1 as SessionTransport } from './desktop-photo-library-session-client-current-v1.ts';
import type { CreatePhotoLibrarySessionCurrentV1 } from '../common/editor/photo-library-session-port-current-v1.ts';
import type { LoadPhotoLibraryRestoreRuntimeV1 } from '../common/editor/photo-library-restore-port-v1.ts';

export interface DesktopPhotoBackendPortsCurrentV1 {
	readonly session: Readonly<SessionTransport>;
	readonly restore: Readonly<{ invoke(channel: string, payload: unknown): Promise<unknown> }>;
}
/** This probes only the trusted installed desktop boundary. It opens no library
	* and never converts a partial native bridge into a browser/native mixture. */
export function captureDesktopPhotoBackendPortsCurrentV1(value: unknown): Readonly<DesktopPhotoBackendPortsCurrentV1> | undefined {
	try {
		if (!value || typeof value !== 'object') return;
		const v1: unknown = Reflect.get(value, 'v1'); if (!v1 || typeof v1 !== 'object') return;
		const session: unknown = Reflect.get(v1, 'photoSession'), restore: unknown = Reflect.get(v1, 'photoRestore');
		if (!session || typeof session !== 'object' || !restore || typeof restore !== 'object') return;
		const invoke: unknown = Reflect.get(session, 'invoke'), install: unknown = Reflect.get(session, 'installRetirement'), restoreInvoke: unknown = Reflect.get(restore, 'invoke');
		if (typeof invoke !== 'function' || typeof install !== 'function' || typeof restoreInvoke !== 'function') return;
		return Object.freeze({ session: Object.freeze<SessionTransport>({
			invoke: async (channel, payload) => Reflect.apply(invoke, session, [channel, payload]) as unknown,
			installRetirement(openId, handler) {
				const detach: unknown = Reflect.apply(install, session, [openId, handler]);
				if (typeof detach !== 'function') throw new TypeError('Installed native retirement owner must return its detach function.');
				return () => { Reflect.apply(detach, undefined, []); };
			},
		}), restore: Object.freeze({ invoke: async (channel: string, payload: unknown): Promise<unknown> => Reflect.apply(restoreInvoke, restore, [channel, payload]) as unknown }) });
	} catch { return undefined; }
}
export function createDesktopPhotoBackendFactoriesCurrentV1(name: string, ports: Readonly<DesktopPhotoBackendPortsCurrentV1>): Readonly<{
	createSession: CreatePhotoLibrarySessionCurrentV1; loadRestoreRuntime: LoadPhotoLibraryRestoreRuntimeV1;
}> {
	return Object.freeze({
		async createSession() {
			const [client, runtime] = await Promise.all([import('./desktop-photo-library-session-client-current-v1.ts'), import('./desktop-photo-library-session-runtime-current-v1.ts')]);
			return runtime.createDesktopPhotoLibrarySessionCurrentV1({ name, service: client.createDesktopPhotoLibrarySessionServiceCurrentV1(ports.session) });
		},
		async loadRestoreRuntime() {
			return (await import('./desktop-photo-library-restore-runtime-current-v1.ts')).createDesktopPhotoLibraryRestoreRuntimeCurrentV1({ name, transport: ports.restore });
		},
	});
}
