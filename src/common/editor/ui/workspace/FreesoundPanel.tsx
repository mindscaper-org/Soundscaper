/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { EditorErrorToast } from '../EditorToast.tsx';

import '../audio-editor-design-system/06a-panels-freesound.css';
import { useEffect, useState } from 'react';

import { FreesoundResultRow } from './FreesoundResultRow.tsx';
import type { FreesoundUser } from './freesound-auth-upload-client.ts';
import FreesoundUploadArea from './FreesoundUploadArea.tsx';
import type {
	FreesoundClipUploadReference,
	FreesoundPublishDraft,
	FreesoundUploadQueueSnapshot,
} from './freesound-upload-queue.ts';

export type FreesoundLicenseFilter = 'all' | 'commercial' | 'cc0';
export type FreesoundSort = 'relevance' | 'newest' | 'rating' | 'downloads';
export type FreesoundPanelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FreesoundSearchRequest {
	readonly query: string;
	readonly license: FreesoundLicenseFilter;
	readonly sort: FreesoundSort;
	readonly page: number;
}

export interface FreesoundResultPresentation {
	readonly soundId: number;
	readonly name: string;
	readonly username: string;
	readonly userUrl?: string;
	readonly soundUrl: string;
	readonly licenseName: string;
	readonly licenseCode: 'cc0' | 'cc-by' | 'cc-by-nc';
	readonly licenseUrl: string;
	readonly durationSeconds: number;
	readonly durationLabel: string;
	readonly previewAvailable?: boolean;
	readonly waveformUrl?: string | null;
	readonly actionPending?: boolean;
}

export interface FreesoundPanelState {
	readonly query: string;
	readonly license: FreesoundLicenseFilter;
	readonly sort: FreesoundSort;
	readonly page: number;
	readonly pageCount: number;
	readonly totalResults: number;
	readonly status: FreesoundPanelStatus;
	readonly errorMessage?: string;
	readonly previewingSoundId: number | null;
	readonly previewPaused: boolean;
	readonly previewPositionSeconds?: number;
	readonly results: readonly FreesoundResultPresentation[];
}

export interface FreesoundPanelAuthState {
	readonly status: 'loading' | 'disconnected' | 'connecting' | 'connected' | 'error';
	readonly user?: FreesoundUser;
	readonly errorMessage?: string;
}

export interface FreesoundPanelProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly state: FreesoundPanelState;
	readonly disabled: boolean;
	readonly projectBinVisible?: boolean;
	readonly onSearch: (request: FreesoundSearchRequest) => void;
	readonly onPreview: (soundId: number) => void;
	readonly onPausePreview: () => void;
	readonly onResumePreview: () => void;
	readonly onSeekPreview: (soundId: number, seconds: number) => void;
	readonly onInsertAtPlayhead: (soundId: number) => void;
	readonly onAddToProjectBin: (soundId: number) => void;
	readonly auth?: FreesoundPanelAuthState;
	readonly uploadQueue?: FreesoundUploadQueueSnapshot;
	readonly uploadRevealRevision?: number;
	readonly onConnect?: () => void;
	readonly onDisconnect?: () => void;
	readonly onUploadFiles?: (files: readonly File[]) => void;
	readonly onUploadProjectClip?: (reference: FreesoundClipUploadReference) => void;
	readonly onPublishUpload?: (id: string, draft: FreesoundPublishDraft) => Promise<void> | void;
	readonly onRetryUpload?: (id: string) => void;
	readonly onCancelUpload?: (id: string) => void;
	readonly onRemoveUpload?: (id: string) => void;
}

const LICENSE_FILTERS: readonly FreesoundLicenseFilter[] = Object.freeze(['all', 'commercial', 'cc0']);
const SORTS: readonly FreesoundSort[] = Object.freeze(['relevance', 'newest', 'rating', 'downloads']);


function fill(template: string, replacements: Readonly<Record<string, string | number>>): string {
	return Object.entries(replacements).reduce(
		(value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)),
		template,
	);
}

function licenseLabel(copy: Readonly<Record<string, string>>, license: FreesoundLicenseFilter): string {
	return {
		all: copy.licenseAll,
		commercial: copy.licenseCommercial,
		cc0: copy.licenseNoAttribution,
	}[license];
}

function sortLabel(copy: Readonly<Record<string, string>>, sort: FreesoundSort): string {
	return {
		relevance: copy.sortRelevance,
		newest: copy.sortNewest,
		downloads: copy.sortDownloads,
		rating: copy.sortRating,
	}[sort];
}

export function FreesoundPanel({
	copy,
	state,
	disabled,
	projectBinVisible = true,
	onSearch,
	onPreview,
	onPausePreview,
	onResumePreview,
	onSeekPreview,
	onInsertAtPlayhead,
	onAddToProjectBin,
	auth,
	uploadQueue,
	uploadRevealRevision,
	onConnect,
	onDisconnect,
	onUploadFiles,
	onUploadProjectClip,
	onPublishUpload,
	onRetryUpload,
	onCancelUpload,
	onRemoveUpload,
}: FreesoundPanelProps) {
	const [query, setQuery] = useState(state.query);
	useEffect(() => setQuery(state.query), [state.query]);
	const loading = state.status === 'loading';
	const search = (request: Partial<FreesoundSearchRequest> = {}) => onSearch({
		query: request.query ?? query.trim(),
		license: request.license ?? state.license,
		sort: request.sort ?? state.sort,
		page: request.page ?? 1,
	});
	const resultSummary = fill(copy.resultsCount, { count: state.totalResults });
	const pageLabel = fill(copy.page, {
		page: Math.max(1, state.page),
		pages: Math.max(1, state.pageCount),
	});

	return (
		<section className="kw-audio-editor__freesound" data-freesound-panel="true" aria-busy={loading}>
			<form className="kw-audio-editor__freesound-search" role="search" onSubmit={(event) => {
				event.preventDefault();
				search({ query: query.trim(), page: 1 });
			}}>
				<label className="kw-audio-editor__freesound-query">
					<span className="kw-audio-editor-sr-only">{copy.searchLabel}</span>
					<input
						type="search"
						value={query}
						placeholder={copy.searchPlaceholder}
						disabled={loading}
						onChange={(event) => setQuery(event.currentTarget.value)}
					/>
				</label>
				<Button type="submit" variant="primary" size="small" disabled={loading || !query.trim()}>
					{copy.search}
				</Button>
				<div className="kw-audio-editor__freesound-filters">
					<label>
						<span>{copy.filterLicense}</span>
						<select
							aria-label={copy.filterLicense}
							value={state.license}
							disabled={loading || !query.trim()}
							onChange={(event) => search({
								license: event.currentTarget.value as FreesoundLicenseFilter,
								page: 1,
							})}
						>
							{LICENSE_FILTERS.map((license) => (
								<option key={license} value={license}>{licenseLabel(copy, license)}</option>
							))}
						</select>
					</label>
					<label>
						<span>{copy.sort}</span>
						<select
							aria-label={copy.sort}
							value={state.sort}
							disabled={loading || !query.trim()}
							onChange={(event) => search({
								sort: event.currentTarget.value as FreesoundSort,
								page: 1,
							})}
						>
							{SORTS.map((sort) => <option key={sort} value={sort}>{sortLabel(copy, sort)}</option>)}
						</select>
					</label>
				</div>
			</form>

			<div className="kw-audio-editor__freesound-status" aria-live="polite">
				{loading ? <p role="status">{copy.searching}</p> : null}
				{state.status === 'ready' && state.results.length > 0 ? <p>{resultSummary}</p> : null}
				{auth?.errorMessage ? <p className="kw-audio-editor__freesound-auth-error">{auth.errorMessage}</p> : null}
			</div>
			{state.status === 'error' && <div className="kw-audio-editor__toasts kw-audio-editor__freesound-toasts">
				<EditorErrorToast key={state.errorMessage || copy.searchError} id="freesound-search-error"
					title={copy.searchError} description={state.errorMessage}
					dismissLabel={copy.close} />
			</div>}

			{state.status === 'idle' ? <p className="kw-audio-editor__panel-empty">{copy.searchPrompt}</p> : null}
			{state.status === 'ready' && state.results.length === 0
				? <p className="kw-audio-editor__panel-empty">{copy.noResults}</p>
				: null}
			{state.results.length > 0 ? (
				<ul className="kw-audio-editor__freesound-results" aria-label={copy.results}>
					{state.results.map((result) => <FreesoundResultRow key={result.soundId} result={result} copy={copy} disabled={disabled}
						projectBinVisible={projectBinVisible} previewing={state.previewingSoundId === result.soundId}
						playing={state.previewingSoundId === result.soundId && !state.previewPaused}
						positionSeconds={state.previewingSoundId === result.soundId ? state.previewPositionSeconds ?? 0 : 0}
						onPreview={onPreview} onPausePreview={onPausePreview} onResumePreview={onResumePreview}
						onSeekPreview={onSeekPreview} onInsertAtPlayhead={onInsertAtPlayhead} onAddToProjectBin={onAddToProjectBin} />)}
				</ul>
			) : null}

			{state.pageCount > 1 ? (
				<nav className="kw-audio-editor__freesound-pagination" aria-label={copy.pagination}>
					<Button
						size="small"
						disabled={loading || state.page <= 1}
						onClick={() => search({ query: state.query, page: state.page - 1 })}
					>{copy.previousPage}</Button>
					<span aria-live="polite">{pageLabel}</span>
					<Button
						size="small"
						disabled={loading || state.page >= state.pageCount}
						onClick={() => search({ query: state.query, page: state.page + 1 })}
					>{copy.nextPage}</Button>
				</nav>
			) : null}
			<p className="kw-audio-editor__freesound-credit">
				{copy.resultsProvidedBy}{' '}
				<a href="https://freesound.org/" target="_blank" rel="noreferrer">{copy.siteName}</a>
				{auth ? <>{' · '}<FreesoundAuthAction
					copy={copy}
					auth={auth}
					onConnect={onConnect}
					onDisconnect={onDisconnect}
				/></> : null}
			</p>
			{auth?.status === 'connected' && uploadQueue ? <FreesoundUploadArea
				copy={copy}
				disabled={disabled}
				queue={uploadQueue}
				revealRevision={uploadRevealRevision}
				onFiles={onUploadFiles}
				onProjectClip={onUploadProjectClip}
				onPublish={onPublishUpload}
				onRetry={onRetryUpload}
				onCancel={onCancelUpload}
				onRemove={onRemoveUpload}
			/> : null}
		</section>
	);
}

function FreesoundAuthAction({
	copy,
	auth,
	onConnect,
	onDisconnect,
}: Readonly<{
	copy: Readonly<Record<string, string>>;
	auth: FreesoundPanelAuthState;
	onConnect?: () => void;
	onDisconnect?: () => void;
}>) {
	if (auth.status === 'connected') return <>
		<span>{fill(copy.connectedAs, { username: auth.user?.username || copy.freesoundAccount })}</span>{' '}
		<button type="button" className="kw-audio-editor__freesound-text-action" onClick={onDisconnect}>
			{copy.disconnectFreesound}
		</button>
	</>;
	if (auth.status === 'loading') return <span>{copy.checkingFreesoundAccount}</span>;
	return <button
		type="button"
		className="kw-audio-editor__freesound-text-action"
		disabled={auth.status === 'connecting'}
		onClick={onConnect}
	>
		{auth.status === 'connecting' ? copy.connectingFreesound : copy.connectFreesound}
	</button>;
}


export default FreesoundPanel;
