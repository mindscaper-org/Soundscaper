/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SoundscaperDesktopProjectLibraryMain } from '../../desktop/soundscaper-project-library-main.ts';

type SoundscaperSession = ReturnType<SoundscaperDesktopProjectLibraryMain['openSession']>;

export function soundscaperLibrarySessionBridge(
	main: SoundscaperDesktopProjectLibraryMain,
	session: SoundscaperSession,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		connect: async () => main.localHandshake,
		handshakeState: () => 'admitted',
		listProjects: () => session.listProjects(),
		claimProjectWriteFence: (projectId: string) => session.claimProjectWriteFence(projectId),
		checkProjectWriteFence: (request: unknown) => session.checkProjectWriteFence(request),
		readProjectBundle: (projectId: string) => session.readProjectBundle(projectId),
		readBodyChunk: (request: unknown) => session.readBodyChunk(request),
		beginPublication: (request: unknown) => session.beginPublication(request),
		writePublicationChunk: (request: unknown) => session.writePublicationChunk(request),
		finishPublication: (request: unknown) => session.finishPublication(request),
		abortPublication: (request: unknown) => session.abortPublication(request),
		deleteProject: (request: unknown) => session.deleteProject(request),
		duplicateProject: (request: unknown) => session.duplicateProject(request),
		persistNativePluginState: async (bytes: Uint8Array) => main.persistNativePluginState(bytes),
		readNativePluginState: async (bodyId: string) => main.readNativePluginState(bodyId),
	});
}
