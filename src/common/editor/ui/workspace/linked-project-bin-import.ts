/* SPDX-License-Identifier: AGPL-3.0-only */

import { handoffLinkedAudioChoice } from './linked-audio-choice-handoff.ts';
import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';

interface LinkedChoice {
	readonly file: Blob;
	readonly locatorId: string;
	readonly locatorRevision: string;
}

interface LinkedProjectBinImportRuntime {
	getProjectSessionKey(): string;
	choose(): PromiseLike<LinkedChoice | null>;
	release(reference: Readonly<{ locatorId: string; locatorRevision: string }>): PromiseLike<boolean>;
	importFile(file: Blob, options: Readonly<Record<string, unknown>>): PromiseLike<unknown>;
}

/** A chooser owns its pathless locator until publication enters the original project. */
export async function importLinkedProjectBinChoice(runtime: LinkedProjectBinImportRuntime, kind: 'audio' | 'video') {
	const scope = Object.freeze({ projectSessionKey: runtime.getProjectSessionKey() });
	return handoffLinkedAudioChoice({
		choose: runtime.choose,
		release: runtime.release,
		isCurrent: (captured) => runtime.getProjectSessionKey() === captured.projectSessionKey,
		accept: (file, reference) => withWebFileLoadLimitContext(() => runtime.importFile(file, {
			destination: 'project-bin',
			[kind === 'audio' ? 'linkedAudioLocatorId' : 'linkedVideoLocatorId']: reference.locatorId,
			[kind === 'audio' ? 'linkedAudioLocatorRevision' : 'linkedVideoLocatorRevision']: reference.locatorRevision,
		})),
	}, scope);
}
