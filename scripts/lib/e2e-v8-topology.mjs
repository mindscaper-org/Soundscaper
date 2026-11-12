/* SPDX-License-Identifier: AGPL-3.0-only */

import { diagnosticErrorMessage as errorMessage } from './diagnostic-error-message.ts';

import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { deriveTopology, sourceOwnership, coverageCounter, validateBranch } from './e2e-v8-source-topology.mjs';
import { validateV8FunctionObservations, validateV8OwnerMultiplicity } from './e2e-v8-function-topology.mjs';

/**
 * Bind V8's runtime ranges to a denominator parsed independently from the
 * authenticated emitted JavaScript. Mapped chunks admit only generated code
 * attributed to the inventory's first-party sources; the script root remains
 * mandatory because V8 reports it for every admitted executable.
 *
 * Branch count inequalities are anti-omission consistency checks for counted
 * precise coverage. They are deliberately limited to syntax whose decision
 * and outcome probes have sound V8 count relationships.
 */
export function validateE2ERawV8Topology({ artifactRoot, profiles, scripts, qualifiedNodeSources = new Set() }) {
	if (typeof artifactRoot !== 'string' || !Array.isArray(profiles) || !Array.isArray(scripts)) {
		throw new TypeError('Raw V8 topology validation needs an artifact root, profiles, and scripts.');
	}
	const entriesByUrl = collectEntries(profiles);
	const sourceMapsByUrl = collectSourceMaps(profiles);
	const failures = [];
	for (const group of groupEquivalentScripts(scripts)) {
		const observedScripts = group.scripts.filter(({ coverageUrl }) => entriesByUrl.has(coverageUrl));
		const entries = observedScripts.flatMap(({ coverageUrl }) => entriesByUrl.get(coverageUrl) ?? []);
		if (entries.length === 0) continue;
		const script = observedScripts[0];
		let source;
		try {
			source = readFileSync(resolveInside(artifactRoot, script.artifactPath), 'utf8');
		} catch (error) {
			failures.push(`${script.id} topology source could not be read: ${errorMessage(error)}`);
			continue;
		}
		const ownerships = observedScripts.map((member) => sourceOwnership({
			caches: sourceMapsByUrl.get(member.coverageUrl),
			script: member,
			source,
		}));
		for (const ownership of ownerships) failures.push(...ownership.failures);
		if (ownerships.some(({ failures: mapFailures }) => mapFailures.length > 0)) continue;
		const topology = deriveTopology(source, script.artifactPath, ownerships[0]);
		failures.push(...topology.failures.map((failure) => `${script.id} ${failure}`));
		const nativeOwnership = sourceOwnership({ source, caches: sourceMapsByUrl.get(script.coverageUrl),
			script: { ...script, sources: script.sources?.filter(path => !qualifiedNodeSources.has(path)) } });
		const requiredOwners = topology.owners.flatMap(owner => {
			const exclusions = topology.functionTopology.functions.filter(shape => (
				owner.start <= shape.start && shape.end <= owner.end
				&& (owner.start !== shape.start || owner.end !== shape.end)
			)).map(({ start, end }) => ({ start, end })).sort((left, right) => left.start - right.start);
			const native = nativeOwnership.ownsAny(owner.start, owner.end, exclusions);
			// Every native root remains mandatory. A mixed owner retains its entire strict topology.
			return native ? [owner] : owner.kind === 'root' ? [{ ...owner, branches: [] }] : [];
		});
		const observations = entries.flatMap(({ functions }) => Array.isArray(functions) ? functions : []);
		for (const { functions } of entries) {
			if (!Array.isArray(functions)) continue;
			failures.push(...validateV8FunctionObservations(
				functions,
				topology.functionTopology,
				source.length,
				script.id,
			));
		}
		failures.push(...validateV8OwnerMultiplicity(entries, requiredOwners, script.id));
		for (const owner of requiredOwners) {
			const matches = observations.filter((observation) => hasSpan(observation, owner));
			if (matches.length === 0) {
				failures.push(`${script.id} is missing the source-derived ${owner.kind} function span ${span(owner)}.`);
				continue;
			}
			const detailedMatches = matches.filter(({ isBlockCoverage }) => isBlockCoverage === true);
			if (detailedMatches.length === 0) {
				failures.push(`${script.id} ${owner.label} supplied no detailed block coverage.`);
				continue;
			}
			if (owner.branches.length === 0) continue;
			const measured = coverageCounter(matches);
			const properRanges = detailedMatches.flatMap(({ ranges }) => ranges.slice(1));
			if (properRanges.length === 0) {
				failures.push(`${script.id} ${owner.label} is missing source-derived branch topology.`);
				continue;
			}
			for (const branch of owner.branches) {
				const failure = validateBranch(branch, measured, properRanges);
				if (failure) failures.push(`${script.id} ${owner.label} ${failure}`);
			}
		}
	}
	return failures;
}

function collectSourceMaps(profiles) {
	const byUrl = new Map();
	for (const profile of profiles) {
		for (const [url, cache] of Object.entries(profile?.['source-map-cache'] ?? {})) {
			const values = byUrl.get(url) ?? [];
			values.push(cache);
			byUrl.set(url, values);
		}
	}
	return byUrl;
}

function collectEntries(profiles) {
	const byUrl = new Map();
	for (const profile of profiles) {
		for (const entry of profile?.result ?? []) {
			if (typeof entry?.url !== 'string') continue;
			const entries = byUrl.get(entry.url) ?? [];
			entries.push(entry);
			byUrl.set(entry.url, entries);
		}
	}
	return byUrl;
}

function groupEquivalentScripts(scripts) {
	const groups = new Map();
	for (const script of scripts) {
		const members = groups.get(script.coverageKey) ?? [];
		members.push(script);
		groups.set(script.coverageKey, members);
	}
	return [...groups.entries()].map(([coverageKey, members]) => ({
		coverageKey,
		scripts: members,
	}));
}

function hasSpan({ ranges }, { start, end }) {
	return Array.isArray(ranges)
		&& ranges[0]?.startOffset === start
		&& ranges[0]?.endOffset === end;
}

function resolveInside(root, candidate) {
	if (typeof candidate !== 'string' || candidate.length === 0 || isAbsolute(candidate)) {
		throw new Error('the artifact path is not a portable relative path');
	}
	const resolvedRoot = resolve(root);
	const resolved = resolve(resolvedRoot, candidate);
	const escaped = relative(resolvedRoot, resolved);
	if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
		throw new Error('the artifact path escapes the artifact root');
	}
	return resolved;
}

function span({ start, end }) {
	return `${start}-${end}`;
}
