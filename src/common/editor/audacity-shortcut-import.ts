/* SPDX-License-Identifier: AGPL-3.0-only */

import { recognizedShortcutKey } from './audio-editor-shortcut-key-validation.ts';
import {
	audioEditorShortcutConflictKey, normalizeAudioEditorShortcut,
} from './audio-editor-shortcut-normalization.ts';
import { audacityShortcutImportCommand } from './audacity-shortcut-import-commands.ts';
import { parseXmlDocument, type XmlElement } from './dawproject-xml.ts';

type ShortcutMap = Readonly<Record<string, readonly string[]>>;
export const AUDACITY_SHORTCUT_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export interface AudacityShortcutImportSkip {
	readonly command: string;
	readonly binding?: string;
	readonly reason: 'unsupported-command' | 'invalid-shortcut' | 'reserved-shortcut' | 'duplicate-shortcut';
}

export interface AudacityShortcutImportPlan {
	readonly format: 'audacity-3' | 'audacity-4';
	readonly shortcuts: Record<string, string[]>;
	readonly importedCount: number;
	readonly skipped: readonly AudacityShortcutImportSkip[];
	readonly reassignedCount: number;
}

export interface AudacityShortcutImportOptions {
	readonly availableActionIds?: readonly string[];
	readonly reservedShortcuts?: ShortcutMap;
	readonly isReservedBinding?: (binding: string) => boolean;
}

interface ImportRecord {
	readonly command: string;
	readonly bindings: readonly string[];
	readonly platformDefault?: boolean;
}

/** Read the export without changing preferences. Applying the returned map is a separate UI action. */
export function parseAudacityShortcutImport(
	xml: string, currentShortcuts: ShortcutMap, options: AudacityShortcutImportOptions = {},
): AudacityShortcutImportPlan {
	const root = parseXmlDocument(xml, {
		maximumBytes: AUDACITY_SHORTCUT_IMPORT_MAX_BYTES, maximumDepth: 8,
		maximumElements: 50_000, maximumTextBytes: 4096,
	}, { allowedSimpleDoctype: '' });
	const legacy = root.name === 'audacitykeyboard';
	if (!legacy && root.name !== 'Shortcuts') throw new SyntaxError('This XML is not an Audacity shortcut document.');
	const records = readRecords(root, legacy);
	if (!records.length) throw new SyntaxError('The Audacity shortcut document has no commands.');
	const available = options.availableActionIds ? new Set(options.availableActionIds) : undefined;
	const reserved = new Set(['primary+k']);
	for (const bindings of Object.values(options.reservedShortcuts ?? {})) {
		for (const binding of bindings) reserved.add(audioEditorShortcutConflictKey(binding));
	}
	const imported = new Map<string, string[]>();
	const owners = new Map<string, string>();
	const skipped: AudacityShortcutImportSkip[] = [];
	for (const record of records) {
		const actionId = audacityShortcutImportCommand(record.command, legacy, available);
		if (!actionId) {
			skipped.push({ command: record.command, reason: 'unsupported-command' });
			continue;
		}
		if (record.platformDefault) {
			skipped.push({ command: record.command, reason: 'invalid-shortcut' });
			continue;
		}
		if (record.bindings.every((binding) => !binding.trim())) {
			if (!imported.has(actionId)) imported.set(actionId, []);
			continue;
		}
		for (const raw of record.bindings) {
			if (!raw.trim()) continue;
			const binding = normalizeImportBinding(raw, legacy);
			if (!binding) {
				skipped.push({ command: record.command, binding: raw, reason: 'invalid-shortcut' });
				continue;
			}
			const conflictKey = audioEditorShortcutConflictKey(binding);
			if (reserved.has(conflictKey) || options.isReservedBinding?.(binding)) {
				skipped.push({ command: record.command, binding: raw, reason: 'reserved-shortcut' });
				continue;
			}
			const owner = owners.get(conflictKey);
			if (owner && owner !== actionId) {
				skipped.push({ command: record.command, binding: raw, reason: 'duplicate-shortcut' });
				continue;
			}
			if (owner === actionId) continue;
			owners.set(conflictKey, actionId);
			const bindings = imported.get(actionId) ?? [];
			bindings.push(binding);
			imported.set(actionId, bindings);
		}
	}
	const shortcuts: Record<string, string[]> = {};
	let reassignedCount = 0;
	for (const [actionId, bindings] of Object.entries(currentShortcuts)) {
		shortcuts[actionId] = bindings.filter((binding) => {
			const owner = owners.get(audioEditorShortcutConflictKey(binding));
			if (!owner || owner === actionId) return true;
			reassignedCount += 1;
			return false;
		});
	}
	for (const [actionId, bindings] of imported) shortcuts[actionId] = bindings;
	return {
		format: legacy ? 'audacity-3' : 'audacity-4', shortcuts,
		importedCount: imported.size, skipped, reassignedCount,
	};
}

function readRecords(root: XmlElement, legacy: boolean): ImportRecord[] {
	const records: ImportRecord[] = [];
	for (const element of root.children) {
		if (element.name !== (legacy ? 'command' : 'SC')) continue;
		if (legacy) {
			const command = element.attributes.name;
			const binding = element.attributes.key;
			if (!command?.trim() || binding === undefined || element.children.length) {
				throw new SyntaxError('An Audacity shortcut command requires name and key attributes.');
			}
			records.push({ command, bindings: [binding] });
		} else {
			const keys = element.children.filter((child) => child.name === 'key');
			const sequences = element.children.filter((child) => child.name === 'seq');
			if (keys.length !== 1 || !keys[0]?.text || keys[0].children.length
				|| sequences.some((sequence) => sequence.children.length > 0)) {
				throw new SyntaxError('An Audacity shortcut command requires one key element and plain sequences.');
			}
			records.push({
				command: keys[0].text, bindings: sequences.map((sequence) => sequence.text),
				platformDefault: !sequences.some((sequence) => sequence.text.trim())
					&& element.children.some((child) => child.name === 'std' && child.text !== '0'),
			});
		}
	}
	return records;
}

function normalizeImportBinding(raw: string, legacy: boolean): string | null {
	try {
		// wx RawCtrl means physical Control on macOS, which this editor's portable
		// primary modifier cannot express. Multi-step Qt sequences are also unsupported.
		if (/(?:RawCtrl|XCtrl)\+/iu.test(raw) || /,\s+\S/u.test(raw)) return null;
		if (legacy && /(?:^|\+)Control\+/iu.test(raw)) return null;
		// Qt Meta is physical Control on macOS and the system modifier elsewhere;
		// the export carries no platform marker, so its meaning cannot be preserved.
		if (!legacy && /(?:^|\+)Meta\+/iu.test(raw)) return null;
		const normalized = normalizeAudioEditorShortcut(legacy ? raw.replace(/Command\+/giu, 'Ctrl+') : raw);
		return recognizedShortcutKey(normalized) ? normalized : null;
	} catch {
		return null;
	}
}
