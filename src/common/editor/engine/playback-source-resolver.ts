/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EngineSourceResolver } from './types.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';

const factories = new WeakMap<EngineRuntimeHost, EngineSourceResolver | null>();

export function capturePlaybackSourceResolver(engine: EngineRuntimeHost): void {
	const factory = factories.has(engine) ? factories.get(engine)! : engine.sourceResolver;
	factories.set(engine, factory);
	engine.sourceResolver = factory?.snapshot?.() ?? factory;
}

export function setPlaybackSourceResolver(engine: EngineRuntimeHost, resolver: EngineSourceResolver | null): void {
	factories.set(engine, resolver);
	capturePlaybackSourceResolver(engine);
}

export function inheritPlaybackSourceResolver(engine: EngineRuntimeHost, candidate: EngineRuntimeHost): void {
	factories.set(candidate, factories.has(engine) ? factories.get(engine)! : engine.sourceResolver);
}
