/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_STACK_LIMITS_V1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';

const stable = (column: string) => `length(${column}) BETWEEN 1 AND 128 AND ${column} GLOB '[A-Za-z0-9]*' AND ${column} NOT GLOB '*[^A-Za-z0-9._:-]*'`;
function relation(name: string): string {
	return `CREATE TABLE ${name} (
	photo_key TEXT PRIMARY KEY NOT NULL,
	catalog_id TEXT NOT NULL CHECK (${stable('catalog_id')}),
	photo_id TEXT NOT NULL CHECK (${stable('photo_id')}),
	stack_key TEXT NOT NULL,
	stack_id TEXT NOT NULL CHECK (${stable('stack_id')}),
	member_position INTEGER NOT NULL CHECK (member_position BETWEEN 0 AND ${PHOTO_STACK_LIMITS_V1.maximumPhotos - 1}),
	CHECK (photo_key = catalog_id || '|' || photo_id),
	CHECK (stack_key = catalog_id || '|' || stack_id),
	FOREIGN KEY (catalog_id, photo_key) REFERENCES native_photos(catalog_id, photo_key) ON DELETE CASCADE,
	FOREIGN KEY (catalog_id, stack_key) REFERENCES native_photo_stacks(catalog_id, stack_key) ON DELETE CASCADE,
	UNIQUE (stack_key, member_position)
) STRICT`;
}
function forward(name: string, event: 'INSERT' | 'UPDATE'): string {
	return `CREATE TRIGGER ${name} AFTER ${event} ON native_photo_stacks
BEGIN
	${event === 'UPDATE' ? `SELECT CASE WHEN NEW.stack_key IS NOT OLD.stack_key OR NEW.catalog_id IS NOT OLD.catalog_id OR NEW.stack_id IS NOT OLD.stack_id
		THEN RAISE(ABORT, 'Native stack identity is immutable.') END;
	DELETE FROM native_photo_stack_forward_members WHERE stack_key = OLD.stack_key;` : ''}
	SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.document, '$.photoIds') WHERE type <> 'text')
		THEN RAISE(ABORT, 'Native stack members require text identities.') END;
	SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM json_each(NEW.document, '$.photoIds') WHERE value = NEW.cover_photo_id)
		THEN RAISE(ABORT, 'Native stack cover must belong to its membership.') END;
	INSERT INTO native_photo_stack_forward_members(photo_key,catalog_id,photo_id,stack_key,stack_id,member_position)
		SELECT NEW.catalog_id || '|' || member.value, NEW.catalog_id, member.value, NEW.stack_key, NEW.stack_id, member.key
		FROM json_each(NEW.document, '$.photoIds') AS member;
END`;
}

/** Forward rows are SQLite-owned projections, never an alternative publisher
 * of grouping truth. Reverse rows remain independent so missing or contradictory
 * custody can be refused through bounded point/per-stack authentication. */
export const LIGHTSCAPER_NATIVE_STACK_SCHEMA_CURRENT_V1 = Object.freeze([
	{ type: 'table', name: 'native_photo_stacks', sql: `CREATE TABLE native_photo_stacks (
	stack_key TEXT PRIMARY KEY NOT NULL,
	catalog_id TEXT NOT NULL CHECK (${stable('catalog_id')}) REFERENCES native_photo_catalogs(id) ON DELETE CASCADE,
	stack_id TEXT NOT NULL CHECK (${stable('stack_id')}),
	revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}),
	document TEXT NOT NULL CHECK (length(CAST(document AS BLOB)) BETWEEN 1 AND ${PHOTO_STACK_LIMITS_V1.maximumDocumentBytes}),
	photo_count INTEGER NOT NULL CHECK (photo_count BETWEEN 2 AND ${PHOTO_STACK_LIMITS_V1.maximumPhotos}),
	cover_photo_id TEXT NOT NULL CHECK (${stable('cover_photo_id')}),
	CHECK (stack_key = catalog_id || '|' || stack_id),
	CHECK (json_valid(document) AND json_type(document) IS 'object'),
	CHECK (json_type(document, '$.schemaVersion') IS 'integer' AND json_extract(document, '$.schemaVersion') IS 1),
	CHECK (json_extract(document, '$.kind') IS 'photo-stack'),
	CHECK (json_type(document, '$.catalogId') IS 'text' AND json_extract(document, '$.catalogId') IS catalog_id),
	CHECK (json_type(document, '$.id') IS 'text' AND json_extract(document, '$.id') IS stack_id),
	CHECK (json_type(document, '$.revision') IS 'integer' AND json_extract(document, '$.revision') IS revision),
	CHECK (json_type(document, '$.photoIds') IS 'array' AND json_array_length(document, '$.photoIds') = photo_count),
	CHECK (json_type(document, '$.coverPhotoId') IS 'text' AND json_extract(document, '$.coverPhotoId') IS cover_photo_id),
	UNIQUE (catalog_id, stack_key)
) STRICT` },
	{ type: 'table', name: 'native_photo_stack_states', sql: `CREATE TABLE native_photo_stack_states (
	catalog_id TEXT PRIMARY KEY NOT NULL CHECK (${stable('catalog_id')}) REFERENCES native_photo_catalogs(id) ON DELETE CASCADE,
	revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}),
	stack_count INTEGER NOT NULL CHECK (stack_count BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER})
) STRICT` },
	{ type: 'table', name: 'native_photo_stack_forward_members', sql: relation('native_photo_stack_forward_members') },
	{ type: 'table', name: 'native_photo_stack_memberships', sql: relation('native_photo_stack_memberships') },
	{ type: 'index', name: 'native_photo_stack_forward_catalog_key', sql: 'CREATE INDEX native_photo_stack_forward_catalog_key ON native_photo_stack_forward_members(catalog_id, photo_key)' },
	{ type: 'index', name: 'native_photo_stack_memberships_catalog_key', sql: 'CREATE INDEX native_photo_stack_memberships_catalog_key ON native_photo_stack_memberships(catalog_id, photo_key)' },
	{ type: 'trigger', name: 'native_photo_stacks_forward_insert', sql: forward('native_photo_stacks_forward_insert', 'INSERT') },
	{ type: 'trigger', name: 'native_photo_stacks_forward_update', sql: forward('native_photo_stacks_forward_update', 'UPDATE') },
]);
