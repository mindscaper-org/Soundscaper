/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestMediaContent } from '../../src/common/media/content-digest.ts';
import {
	bindFramescaperVideoProxyActionRuntime,
	registerFramescaperVideoProxyActionRuntime,
} from '../../src/framescaper/editor-video-proxy-action-runtime.ts';
import {
	createFramescaperNativeWatchImportClient,
	type FramescaperNativeWatchImportClient,
} from '../../src/framescaper/editor-native-watch-import-client.ts';
import { enabledNativeWatchAdmission } from './native-watch-admission-fixture.ts';

type Data = Record<string, unknown>;

const PROJECT_ID = 'project-1';
const CLAIM_ID = 'd'.repeat(32);
const LOCATOR_ID = 'b'.repeat(32);
const LOCATOR_REVISION = 'c'.repeat(32);
const PROXY_SHA256 = 'a'.repeat(64);
const NAME = 'clip.mp4';
const MIME = 'video/mp4';
const LAST_MODIFIED = 1_700_000_000_000;
const BYTES = 'framescaper-watch-import';

function watchedFile(): File {
	return new File([BYTES], NAME, { type: MIME, lastModified: LAST_MODIFIED });
}

const SIZE = watchedFile().size;
const CONTENT_SHA256 = await digestMediaContent(watchedFile());
const ATTACHED = Object.freeze({ originalSha256: CONTENT_SHA256, sha256: PROXY_SHA256 });

function videoSource(id: string, proxyAttachment: Data | null = null, sha = CONTENT_SHA256): Data {
	return { kind: 'video', id, contentSha256: sha, proxyAttachment };
}

function projectAt(revision: number, sources: readonly Data[], clipSourceIds: readonly string[]): Data {
	return Object.freeze({
		schemaFamily: 'framescaper', schemaVersion: 1, id: PROJECT_ID, revision, sources,
		projectBin: { clips: clipSourceIds.map((sourceId) => ({ kind: 'video', sourceId })) },
	});
}

const EMPTY = projectAt(2, [], []);
const WITH_EXISTING = projectAt(2, [videoSource('source-existing')], ['source-existing']);
const IMPORTED = projectAt(3, [videoSource('source-imported')], ['source-imported']);

function claim(overrides: Data = {}): Data {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1, claimId: CLAIM_ID, projectId: PROJECT_ID,
		projectRevision: 2, binId: 'project-bin', generateProxies: false, existingSourceId: null,
		importMode: 'link', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION, name: NAME,
		size: SIZE, mimeType: MIME, lastModified: LAST_MODIFIED, contentSha256: CONTENT_SHA256,
		...overrides,
	};
}

interface Recorder {
	readonly claims: Data[];
	readonly imports: { readonly files: readonly Blob[]; readonly options: Data }[];
	readonly flushes: unknown[];
	readonly completions: Data[];
	readonly generated: string[];
	readonly errors: unknown[];
}

interface State { project: Data }

interface RigConfig {
	readonly project?: Data;
	readonly claim?: unknown;
	readonly load?: () => Promise<unknown>;
	readonly complete?: (attempt: number) => boolean;
	readonly onClaim?: () => void;
	readonly onImportFiles?: (state: State) => void;
	readonly onFlush?: (state: State) => void;
	readonly proxy?: (state: State) => void;
	readonly onError?: (error: unknown) => void;
	readonly extra?: Data;
}

interface Rig {
	readonly state: State;
	readonly rec: Recorder;
	readonly watcher: Readonly<FramescaperNativeWatchImportClient>;
}

/** A proxy runtime whose only real method is generate; the rest satisfy the registry contract. */
function proxyRuntime(generate: (sourceId: string) => void): never {
	const inert = async (): Promise<void> => undefined;
	return {
		mode: () => 'auto', previewTrust: () => 'unverified', setMode: inert, pressure: () => null,
		reportPreviewPressure: inert, attachExisting: inert, detach: inert, regenerate: inert,
		generate: async (sourceId: string) => { generate(sourceId); },
		relinkOriginal: async () => 'relinked',
	} as unknown as never;
}

function rig(config: RigConfig = {}): Rig {
	const rec: Recorder = {
		claims: [], imports: [], flushes: [], completions: [], generated: [], errors: [],
	};
	const state: State = { project: 'project' in config ? config.project as Data : EMPTY };
	const controller = {
		get project(): Data { return state.project; },
		actions: { project: {
			async importFiles(files: readonly Blob[], options: Data): Promise<void> {
				rec.imports.push({ files, options });
				config.onImportFiles?.(state);
			},
			async flush(options?: unknown): Promise<void> {
				rec.flushes.push(options);
				config.onFlush?.(state);
			},
		} },
	};
	if (config.proxy) {
		const generate = config.proxy;
		bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime(
			proxyRuntime((sourceId) => { rec.generated.push(sourceId); generate(state); }),
		));
	}
	const watcher = createFramescaperNativeWatchImportClient({
		controller,
		linkedVideoOriginalPort: {
			load: config.load ?? (async () => ({ blob: watchedFile(), locatorRevision: LOCATOR_REVISION })),
		},
		bridge: {
			...enabledNativeWatchAdmission(),
			claimWatchImport: async (request: Data) => {
				rec.claims.push(request);
				config.onClaim?.();
				return 'claim' in config ? config.claim : claim();
			},
			completeWatchImport: async (request: Data) => {
				rec.completions.push(request);
				return config.complete ? config.complete(rec.completions.length) : true;
			},
		},
		autoStart: false,
		onError: config.onError ?? ((error: unknown) => { rec.errors.push(error); }),
		...config.extra,
	} as never);
	return { state, rec, watcher };
}

function messages(rec: Recorder): string[] {
	return rec.errors.map((error) => (error as Error).message);
}

export {
	ATTACHED, BYTES, CLAIM_ID, CONTENT_SHA256, EMPTY, IMPORTED, LAST_MODIFIED, LOCATOR_ID, LOCATOR_REVISION,
	MIME, NAME, PROJECT_ID, PROXY_SHA256, SIZE, WITH_EXISTING, claim, messages, projectAt, rig, videoSource, watchedFile,
	type Data, type Rig,
};
