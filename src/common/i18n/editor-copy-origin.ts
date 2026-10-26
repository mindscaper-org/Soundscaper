/* SPDX-License-Identifier: AGPL-3.0-only */

interface CopyOrigin {
	readonly sources: Readonly<Record<string, string>>;
	readonly values: Readonly<Record<string, unknown>>;
	readonly catalog?: Readonly<Record<string, unknown>>;
}
const ORIGIN = Symbol('editor copy source ownership');
const AUTHENTIC_ORIGINS = new WeakSet<object>();
type OriginCopy = Readonly<Record<string, unknown>> & { readonly [ORIGIN]?: CopyOrigin };

/** Keep global catalog meanings separate from identically named optional-panel labels. */
export function withEditorCopyOrigin<Catalog extends Readonly<Record<string, unknown>>>(
	copy: Catalog, sources: Readonly<Record<string, unknown>> = copy,
): Readonly<Catalog> {
	const values = Object.freeze(Object.fromEntries(Object.entries(copy).filter(([key]) => !key.startsWith('ui.'))));
	const sourceCopy = Object.freeze(Object.fromEntries(Object.entries(sources).filter(([key, value]) => !key.startsWith('ui.') && typeof value === 'string'))) as Readonly<Record<string, string>>;
	return Object.freeze({ ...copy, [ORIGIN]: authenticOrigin({ sources: sourceCopy, values }) });
}

/** Live controller facades must expose the origin belonging to their current snapshot. */
export function forwardEditorCopyOrigin<Target extends object>(target: Target, current: () => OriginCopy): Target {
	let retainedCatalog: OriginCopy | undefined;
	let retainedOrigin: CopyOrigin | undefined;
	return Object.defineProperty(target, ORIGIN, { enumerable: true, get: () => {
		const catalog = current();
		if (catalog !== retainedCatalog) {
			const origin = catalog[ORIGIN];
			retainedCatalog = catalog;
			retainedOrigin = authenticOrigin({ sources: origin?.sources ?? {}, values: origin?.values ?? {}, catalog });
		}
		return retainedOrigin;
	} });
}

export function editorCopyOwnedOverride(copy: OriginCopy, key: string): unknown {
	return copy[key] ?? copy[ORIGIN]?.catalog?.[key];
}

export function editorCopyLocalOverride(copy: OriginCopy, key: string, source: string): unknown {
	const candidate = copy[key];
	const origin = copy[ORIGIN];
	return origin && Object.hasOwn(origin.sources, key) && origin.sources[key] !== source
		&& candidate === origin.values[key] ? undefined : candidate;
}

/** Product adapters may replace generic catalog values without turning them into panel overrides. */
export function rebaseEditorCopyOrigin<Catalog extends OriginCopy>(copy: Catalog, changedKeys?: readonly string[]): Readonly<Catalog> {
	const origin = copy[ORIGIN];
	if (!origin) return Object.freeze(copy);
	if (changedKeys === undefined) return withEditorCopyOrigin(copy, origin.sources);
	const values = { ...origin.values };
	for (const key of changedKeys) if (Object.hasOwn(origin.sources, key)) values[key] = copy[key];
	return Object.freeze({ ...copy, [ORIGIN]: authenticOrigin({ sources: origin.sources, values: Object.freeze(values) }) });
}

/** Bootstrap admission ignores only this module's immutable data descriptor. Foreign symbols still fail. */
export function editorCopyStringKeys(copy: object): readonly PropertyKey[] {
	const descriptor = originDescriptor(copy);
	return Reflect.ownKeys(copy).filter(key => !descriptor || key !== ORIGIN);
}

export function transferEditorCopyOrigin<Target extends object>(target: Target, source: object): Target {
	const descriptor = originDescriptor(source);
	return descriptor ? Object.defineProperty(target, ORIGIN, descriptor) : target;
}

function originDescriptor(copy: object): PropertyDescriptor | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(copy, ORIGIN);
	const value: unknown = descriptor?.value;
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& value !== null && typeof value === 'object' && AUTHENTIC_ORIGINS.has(value) ? descriptor : undefined;
}

function authenticOrigin(origin: CopyOrigin): Readonly<CopyOrigin> {
	AUTHENTIC_ORIGINS.add(origin);
	return Object.freeze(origin);
}
