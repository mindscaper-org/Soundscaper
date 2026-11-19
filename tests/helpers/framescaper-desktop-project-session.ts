/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperDesktopProjectLibraryHandshake } from '../../desktop/framescaper-project-library-contract.ts';
import { FramescaperDesktopProjectLibraryMain } from '../../desktop/framescaper-project-library-main.ts';
import { createFramescaperAudioEditorController, type FramescaperAudioEditorControllerPresentation } from '../../src/framescaper/editor-controller.ts';
import type { FramescaperEditorProjectEnvironment } from '../../src/framescaper/editor-project-environment.ts';
import { openFramescaperImageFixtureLibrary } from './framescaper-portable-timeline-image.ts';

interface SessionOptions {
	readonly openEnvironment?: () => Promise<FramescaperEditorProjectEnvironment>;
	readonly presentation?: FramescaperAudioEditorControllerPresentation;
	readonly duplicateProject?: (request: unknown, publish: () => Promise<unknown>) => Promise<unknown>;
}

export async function startFramescaperDesktopProjectSession(
	directory: string,
	{ openEnvironment = openFramescaperImageFixtureLibrary, presentation = { locale: 'en' }, duplicateProject }: SessionOptions = {},
) {
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	const main = await FramescaperDesktopProjectLibraryMain.start({
		appDataPath: directory, handshake,
		owner: { product: 'framescaper', processId: process.pid, instanceId: crypto.randomUUID() },
		onLeaseLost: () => undefined, testControl: null,
	});
	const session = main.openSession(handshake);
	const bridge = Object.freeze({
		connect: async () => handshake, handshakeState: () => 'admitted',
		listProjects: () => session.listProjects(), readProjectBundle: (id: string) => session.readProjectBundle(id),
		readBodyChunk: (request: unknown) => session.readBodyChunk(request),
		claimProjectWriteFence: (id: string) => Promise.resolve(session.claimProjectWriteFence(id)),
		checkProjectWriteFence: (request: unknown) => session.checkProjectWriteFence(request),
		beginPublication: (request: unknown) => session.beginPublication(request),
		writePublicationChunk: (request: unknown) => session.writePublicationChunk(request),
		finishPublication: (request: unknown) => session.finishPublication(request),
		abortPublication: (request: unknown) => session.abortPublication(request),
		deleteProject: (request: unknown) => session.deleteProject(request),
		duplicateProject: (request: unknown) => duplicateProject
			? duplicateProject(request, () => session.duplicateProject(request)) : session.duplicateProject(request),
	});
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	Object.defineProperty(globalThis, 'framescaperDesktop', { configurable: true, enumerable: true,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary: bridge }) }),
	});
	const release = async () => {
		if (previous) Object.defineProperty(globalThis, 'framescaperDesktop', previous);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
		try { await session.close(); } finally { await main.close(); }
	};
	try {
		const environment = await openEnvironment();
		const controller = createFramescaperAudioEditorController(environment, presentation);
		const close = async () => {
			try { await controller.dispose(); }
			finally { try { await environment.close(); } finally { await release(); } }
		};
		try { await controller.ready; }
		catch (error) { await close(); throw error; }
		return { environment, controller, session, close };
	} catch (error) { await release(); throw error; }
}
