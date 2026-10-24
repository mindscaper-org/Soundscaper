/* SPDX-License-Identifier: AGPL-3.0-only */

export const SCAPE_BINARY_TAG = '$soundscaperOpaqueBinary';
export const SCAPE_LITERAL_KEY_PREFIX = '$soundscaperLiteralKey:';
export const SCAPE_LITERAL_KEYS_FEATURE = 'org.soundscaper.capability.literal-json-keys';
export const SCAPE_LITERAL_KEYS_REQUIREMENT_ID = 'soundscaper.literal-json-keys';

/** Older documents may already contain prefix-shaped names, so decoding is opt-in. */
export function projectDeclaresScapeLiteralKeys(project: unknown): boolean {
	const manifest = ownValue(project, 'featureRequirements');
	const requirements = ownValue(manifest, 'requirements');
	if (!Array.isArray(requirements) || requirements.length > 1024) return false;
	for (let index = 0; index < requirements.length; index++) {
		if (ownValue(ownValue(requirements, String(index)), 'featureId') === SCAPE_LITERAL_KEYS_FEATURE) return true;
	}
	return false;
}

function ownValue(object: unknown, key: string): unknown {
	if (!object || typeof object !== 'object') return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(object, key);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

/** Source compaction must retire a codec requirement with its final literal key. */
export function retireUnusedScapeLiteralKeys<Project>(project: Project): Project {
	if (!project || typeof project !== 'object') return project;
	const manifest = ownValue(project, 'featureRequirements');
	const requirements = ownValue(manifest, 'requirements');
	if (!manifest || typeof manifest !== 'object' || !Array.isArray(requirements)
		|| !requirements.some(row => ownValue(row, 'id') === SCAPE_LITERAL_KEYS_REQUIREMENT_ID)) return project;
	if (projectHasScapeLiteralKeys(project as Readonly<Record<string, unknown>>)) return project;
	return { ...project, featureRequirements: { ...manifest,
		requirements: requirements.filter(row => ownValue(row, 'id') !== SCAPE_LITERAL_KEYS_REQUIREMENT_ID) } };
}

/** Escape only codec-owned spellings; ordinary JSON keeps its existing bytes. */
export function encodeScapeLiteralKey(key: string): string {
	return needsLiteralKeyEscape(key) ? SCAPE_LITERAL_KEY_PREFIX + key : key;
}

function needsLiteralKeyEscape(key: string): boolean {
	return key === SCAPE_BINARY_TAG || key.startsWith(SCAPE_LITERAL_KEY_PREFIX);
}

/** Validate before binary materialization, so malformed input cannot partially decode. */
export function validateScapeLiteralKeys(object: Record<string, unknown>): boolean {
	const decoded = new Set<string>();
	let escaped = false;
	for (const key of Object.keys(object)) {
		const literal = decodeKey(key);
		if (decoded.has(literal)) throw new TypeError('Scape literal JSON keys collide after decoding.');
		decoded.add(literal);
		escaped ||= literal !== key;
	}
	return escaped;
}

/** Keep own-property order, identity and __proto__ data semantics intact. */
export function restoreScapeLiteralKeys(object: Record<string, unknown>): void {
	const entries = Object.entries(object).map(([key, value]) => [decodeKey(key), value] as const);
	for (const key of Object.keys(object)) delete object[key];
	for (const [key, value] of entries) {
		Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
	}
}

function decodeKey(key: string): string {
	if (!key.startsWith(SCAPE_LITERAL_KEY_PREFIX)) return key;
	const literal = key.slice(SCAPE_LITERAL_KEY_PREFIX.length);
	if (!needsLiteralKeyEscape(literal)) throw new TypeError('A Scape literal JSON key escape is noncanonical.');
	return literal;
}

/** The document factory derives refusal truth without invoking metadata accessors. */
export function projectHasScapeLiteralKeys(project: Readonly<Record<string, unknown>>): boolean {
	const pending: unknown[] = [project];
	const seen = new Set<object>();
	let nodes = 0;
	while (pending.length) {
		if (++nodes > 100_000) throw new RangeError('Scape literal-key inspection exceeds the project node limit.');
		const value = pending.pop();
		if (!value || typeof value !== 'object' || seen.has(value)) continue;
		if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;
		seen.add(value);
		if (Array.isArray(value) && value.length > 100_000 - nodes - pending.length) {
			throw new RangeError('Scape literal-key inspection exceeds the project node limit.');
		}
		const keys = Array.isArray(value) ? Array.from({ length: value.length }, (_, index) => String(index)) : Object.keys(value);
		if (!Array.isArray(value) && keys.includes(SCAPE_BINARY_TAG)) return true;
		if (keys.length > 100_000 - nodes - pending.length) {
			throw new RangeError('Scape literal-key inspection exceeds the project node limit.');
		}
		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor && Object.hasOwn(descriptor, 'value')) pending.push(descriptor.value);
		}
	}
	return false;
}
