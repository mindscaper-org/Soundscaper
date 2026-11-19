/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createFramescaperNativeRenderInputStreamProducer } from './editor-native-render-input-stream-producer.ts';
import type { FramescaperNativeRenderInputProducerDependenciesNativeMedia } from './editor-native-render-input-producer.ts';
import {
	admitFramescaperNativeRenderInputAuthorityNativeMedia,
	admitFramescaperNativeRenderInputRequestNativeMedia,
} from './editor-native-render-input-request.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';

type CreateProducer = typeof createFramescaperNativeRenderInputStreamProducer;
type Producer = ReturnType<CreateProducer>;
type OpenFxExecute = FramescaperNativeRenderInputProducerDependenciesNativeMedia['openFxExecute'];
type LoadProducer = () => Promise<CreateProducer>;

/** Keep native export engines behind the existing render-queue action. */
export function createDeferredFramescaperNativeRenderInputStreamProducer(
	profile: Parameters<CreateProducer>[0],
	authorityValue: Parameters<CreateProducer>[1],
	openFxExecute?: OpenFxExecute,
	load: LoadProducer = () => loadProducer(openFxExecute),
): Producer {
	assertFramescaperProjectRuntimeProfile(profile);
	const admitted = admitFramescaperNativeRenderInputAuthorityNativeMedia(authorityValue);
	const authority = Object.freeze({ authority: admitted.authority, store: admitted.store });
	let producer: Producer | null = null;
	let loading: Promise<Producer> | null = null;
	function ensureLoaded(): Promise<Producer> {
		loading ??= Promise.resolve().then(load).then(create => {
			producer = create(profile, authority);
			return producer;
		}).catch((error: unknown) => {
			loading = null;
			throw error;
		});
		return loading;
	}
	return async requestValue => {
		// Snapshot the request before yielding to the chunk load, and retain the
		// controller generation so switching away and back cannot revive it.
		const request = admitFramescaperNativeRenderInputRequestNativeMedia(requestValue);
		if (producer) return producer(request);
		const operation = authority.authority.begin();
		let primary: unknown;
		let cleanupFailure: unknown;
		let cleanupFailed = false;
		let failed = false;
		let ready: Producer | undefined;
		try {
			ready = await ensureLoaded();
			if (operation.signal.aborted) throw operation.signal.reason
				?? new DOMException('Native rendering was cancelled.', 'AbortError');
			operation.assertCurrent();
		} catch (error) {
			primary = error;
			failed = true;
		}
		try { operation.finish(); } catch (cleanup) {
			cleanupFailure = cleanup;
			cleanupFailed = true;
		}
		if (cleanupFailed) {
			if (!failed) throw cleanupFailure;
			throw new AggregateError([primary, cleanupFailure], 'Native render loading and cleanup failed.', { cause: primary });
		}
		if (failed) throw primary;
		return ready!(request);
	};
}

async function loadProducer(openFxExecute: OpenFxExecute): Promise<CreateProducer> {
	const [runtime, defaults] = await Promise.all([
		import('./editor-native-render-input-stream-producer.ts'),
		import('./editor-native-render-input-producer.ts'),
	]);
	return (profile, authority) => runtime.createFramescaperNativeRenderInputStreamProducer(
		profile, authority,
		openFxExecute ? Object.freeze({
			...defaults.FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_NATIVE_MEDIA,
			openFxExecute,
		}) : defaults.FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_NATIVE_MEDIA,
	);
}
