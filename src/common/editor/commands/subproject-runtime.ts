/* SPDX-License-Identifier: AGPL-3.0-only */
import { readSubprojectLinks, validateSubprojectLinks } from '../subprojects.ts';
import { addSource } from './project-source-record-runtime.js';
import type { SubprojectCommand } from './subproject.ts';

/** Each refresh installs a new immutable body; snapshots and undo keep the old source. */
export function applySubprojectCommand(value: object, command: SubprojectCommand): void {
	const project = value as Record<string, unknown>;
	if (project.schemaFamily !== 'soundscaper') throw new RangeError('Subprojects require a Soundscaper project.');
	const links = readSubprojectLinks(project);
	const id = command.type === 'subproject/install' || command.type === 'subproject/relink' ? command.link.id : command.expected.id;
	const current = links.find(link => link.id === id) ?? null;
	if (JSON.stringify(current) !== JSON.stringify(command.expected)) throw new RangeError('The subproject link changed before publication.');
	const metadata = project.metadata as Record<string, unknown>;
	if (command.type === 'subproject/detach') {
		metadata.subprojects = links.filter(link => link.id !== id);
		return;
	}
	if (command.type === 'subproject/follow') {
		if (typeof command.followLatest !== 'boolean') throw new TypeError('A subproject update mode is required.');
		metadata.subprojects = links.map(link => link.id === id ? { ...link, followLatest: command.followLatest } : link);
		return;
	}
	const { link, source } = command;
	if (current && ((command.type !== 'subproject/relink' && (current.projectId !== link.projectId || current.libraryId !== link.libraryId))
		|| current.sampleRate !== link.sampleRate || current.channelCount !== link.channelCount || current.frameCount !== link.frameCount)) {
		throw new RangeError('A proxy refresh must preserve its project identity and published range geometry.');
	}
	if (source.id !== link.sourceId || (current && current.sourceId === link.sourceId)) throw new RangeError('A refreshed proxy requires a new immutable source.');
	const sources = project.sources as Record<string, unknown>[];
	const existing = sources.find(candidate => candidate.id === link.sourceId);
	if (existing && (current || Object.entries(source).some(([key, entry]) => JSON.stringify(existing[key]) !== JSON.stringify(entry)))) throw new RangeError('The proxy source already exists.');
	if (!existing) addSource(project, source);
	metadata.subprojects = current
		? links.map(candidate => candidate.id === id ? { ...link } : candidate)
		: [...links, { ...link }];
	validateSubprojectLinks(project);
	if (current) {
		const bin = project.projectBin as { clips?: Record<string, unknown>[] } | undefined;
		for (const clip of [...project.clips as Record<string, unknown>[], ...bin?.clips ?? []]) {
			if (clip.sourceId === current.sourceId) clip.sourceId = link.sourceId;
		}
	}
}

export function createSubprojectCommandHandlers() {
	return { 'subproject/install': applySubprojectCommand, 'subproject/relink': applySubprojectCommand, 'subproject/follow': applySubprojectCommand, 'subproject/detach': applySubprojectCommand };
}
