/* SPDX-License-Identifier: AGPL-3.0-only */
import { admitAudioExportBlob, prepareAudioExportBlobWithWarning as prepareAudioExportBlob } from '../../../audio-export-output.ts'; import { createLocalizedError, setLocalizedStatus } from '../../../../i18n/presentation-message.ts';
import { audioExportPublicationProgress, setAudioExportCancellation, NO_AUDIO_EXPORT_PROGRESS as NO_TASK_PROGRESS } from './audio/audio-export-progress.ts';
import { isVideoExportRequestFormat } from '../../../video-export-request-format.ts';
import { inheritTrackFolderMediaStateProjectionV12 } from '../../../track-folder-media-runtime.ts';
import { createExportRenderProject, exportReplacementTrackIds } from '../export-render-project.ts';
import { createSpatialExportRenderProject } from './spatial-render-project.ts';
import { publishBufferedExport } from './buffered-export-publication.ts';
import { isOriginalOverwriteSettings } from './overwrite-original-action.ts';
import { originalOverwriteChannelMapping } from './original-overwrite-channel-mapping.ts';
import { retirePreviousExportOutput, reportExportOutputFailure } from './retire-export-output.ts';
import {
	admitAudioRenderedFallbackExport,
	audioRenderedFallbackRenderSources,
} from './audio/audio-rendered-fallback-export.ts';
import {
	admitAudioExportDelivery,
	type AudioExportAdmission,
} from './audio/audio-export-delivery-admission.ts';
import { renderAndEncodeAudioExport, type ExportRenderSources } from './audio/audio-export-render-orchestration.ts';
import { createRealtimeEncodedAudioExport } from './audio/audio-realtime-encoded-export.ts';
import { directPcmContainerLabel, prepareDirectPcmExportDestination } from './direct/direct-export-dispatch.ts';
import {
	commitDirectCompressedDestination, directCompressedCancellation,
	directCompressedStagingTemporaryBytes, prepareDirectCompressedDestination,
	type DirectCompressedDestination,
} from './direct/direct-compressed-export.ts';
import { commitDirectPcmDestination, type DirectPcmDestination } from './direct/direct-pcm-export.ts';
import { commitPreparedDirectStemArchiveDestination, directStemArchiveTemporaryBytes, prepareDirectStemArchiveDestination } from './direct/direct-stem-archive-export.ts';
import { createEditorVideoExportAction } from './video/video-export-service.ts';
import { beginExportTask, handleExportFailure } from './export-task-lifecycle.ts';
import { createExportSnapshotRenderer } from '../export-snapshot-renderer.ts';
import type { EditorExportState } from '../export-state.ts';
import { isCurrentAssertion } from '../../shared/lifecycle.ts';
import { streamStemArchiveExport } from './archive/streaming-stem-archive-export.ts';
import { executeDirectStemRenderArchive } from './direct/direct-stem-render-execution.ts';
import { assertDesktopAudioExportCapability } from './desktop-audio-export-capability.ts';
import { createDeliveryReportForPlan } from '../../../delivery-conversion-inventory.ts';
import {
	assertDeliveryConformance,
	type DeliveryConformanceFinding,
} from '../../../delivery-conformance.ts';
import {
	conformDeliveredExport,
	conformedDeliveryReport,
} from './delivery/delivery-conformance-action.ts';
export interface ExportServiceRuntime {
	readonly state: EditorExportState;
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}
type RuntimeValue = ExportServiceRuntime[string];

export function createEditorExportService(runtime: ExportServiceRuntime) {
	let audioExportActive = false;
	const {
		abortError, applyMediaChannelMapping, audioBufferChannels,
		copy, createAiffStreamEncoder, createCacheAwareRenderEngine, createExportPlan,
		createStableId, createStreamingStemArchive, createStreamingWindowedSincResampler, createTemporaryFileSink,
		createWavStreamEncoder, encodeAiff, encodeWav,
		ffmpeg, fileService,
		handleError, lifetime,
		normalizeProjectSampleRate, options, preflightStorage, prepareCommittedTimePitchCaches, productName,
		projectGeneration, publishDocumentSnapshot,
		resampleBuffer, setStatus, sourceBuffers, sourceChunkProviders, state,
		stemProject, store, throwIfAborted, toggleExport,
		updateExportProgress, taskProgress, verifyProjectFallbackIntegrity,
	} = runtime;
	const suppliedExportSnapshotRenderer = runtime.exportSnapshotRenderer;
	const { renderSnapshot, withRenderProgress } = suppliedExportSnapshotRenderer
		?? createExportSnapshotRenderer({
			options, sourceBuffers, taskProgress,
			createCacheAwareRenderEngine, prepareCommittedTimePitchCaches,
			throwIfAborted, updateExportProgress,
		});
	const exportVideo = createEditorVideoExportAction(runtime, renderSnapshot);
	const renderRealtimeEncoded = createRealtimeEncodedAudioExport({
		applyMediaChannelMapping, copy, createAiffStreamEncoder, createCacheAwareRenderEngine,
		createStableId, createStreamingWindowedSincResampler, createTemporaryFileSink,
		createWavStreamEncoder, ffmpeg, normalizeProjectSampleRate, options,
		prepareCommittedTimePitchCaches, setStatus, taskProgress, throwIfAborted, withRenderProgress,
	});
	async function handleExportAction(
		action: RuntimeValue,
		requestedSettings: RuntimeValue = null,
	) {
		if (action === 'cancel') {
			state.exportGeneration += 1;
			state.exportAbort?.abort();
			state.exportAbort = null;
			toggleExport(false);
			publishDocumentSnapshot();
			return;
		}
		if (isVideoExportRequestFormat(requestedSettings?.format)) {
			return exportVideo(requestedSettings);
		}
		if (state.exportAbort || audioExportActive) return;
		audioExportActive = true;
		try { return await exportAudio(requestedSettings); }
		finally { audioExportActive = false; }
	}

	async function exportAudio(requestedSettings: RuntimeValue) {
		const preparationGeneration = state.exportGeneration;
		const preparationProject = typeof runtime.prepareProjectForExport === 'function' ? projectGeneration.capture() : null;
		if (typeof runtime.prepareProjectForExport === 'function') {
			await runtime.prepareProjectForExport('audio-export');
		}
		if (state.exportAbort || state.exportGeneration !== preparationGeneration || state.disposed
			|| (preparationProject && !isCurrentAssertion(() => projectGeneration.assertCurrent(preparationProject)))) {
			return;
		}
		let admission: AudioExportAdmission;
		const overwriteOriginal = isOriginalOverwriteSettings(requestedSettings);
		try {
			admission = admitAudioExportDelivery(runtime, requestedSettings);
		} catch (error) {
			handleError(error);
			return;
		}
		const { canonicalProject, delivery, deliveredProject, settings } = admission;
		if (!admission.hasMaterial) return;
		if (admission.localSourcesMissing) {
			throw createLocalizedError(Error, copy, 'localSourcesMissing');
		}
		const exportOperation = beginExportTask({
			state, lifetime, projectGeneration, projectId: canonicalProject.id,
			throwIfAborted, abortError, toggleExport,
		});
		const { generation, abort, assertCurrent: assertExportCurrent } = exportOperation;
		const progressTask = taskProgress?.begin?.('export', copy.rendering, 0, { key: 'rendering' }) || NO_TASK_PROGRESS;
		setAudioExportCancellation(progressTask, () => { void handleExportAction('cancel'); });
		let exportProject = createExportRenderProject(deliveredProject, exportReplacementTrackIds(delivery));
		let exportRenderSources: ExportRenderSources;
		let pendingCleanup = null;
		let pendingDirectDestination: DirectPcmDestination | DirectCompressedDestination | null = null;
		let directStemArchive = false;
		let directCompressed = false;
		const browserMaximumOutputBytes = requestedSettings && typeof requestedSettings === 'object'
			? requestedSettings.maximumOutputBytes
			: undefined;
		try {
			const fallbackProvider = await admitAudioRenderedFallbackExport(canonicalProject, delivery, {
				store, verifyProjectFallbackIntegrity,
			}, { signal: abort.signal, assertCurrent: assertExportCurrent });
			exportRenderSources = fallbackProvider && delivery.audioRenderedFallback
				? audioRenderedFallbackRenderSources(delivery.audioRenderedFallback, fallbackProvider, {
					sourceBuffers,
					sourceChunkProviders: sourceChunkProviders ?? new Map(),
				})
				: Object.freeze({
					sourceMap: new Map(sourceBuffers),
					chunkSources: null,
					prepareTimePitchCaches: true,
				});
			const plan = createExportPlan(exportProject, {
				...settings,
				preserveIxmlFileIdentity: overwriteOriginal,
				aifcCompression: overwriteOriginal ? requestedSettings.aifcCompression : undefined,
				channelMapping: overwriteOriginal ? originalOverwriteChannelMapping(exportProject, settings.channelMapping) : settings.channelMapping,
				inputChannelCount: exportProject.masterChannels,
				mobile: state.mobile,
				livePcmBytes: undefined,
				productName,
			});
			await assertDesktopAudioExportCapability(ffmpeg, plan);
			if (typeof ffmpeg.preflightEncodeFile === 'function') {
				await ffmpeg.preflightEncodeFile(plan.format, {
					...plan.encoding,
					frameCount: plan.outputFrames,
					metadata: plan.metadata,
					maximumOutputBytes: browserMaximumOutputBytes,
					signal: abort.signal,
				});
			}
			// Derived from the plan this delivery is about to execute, so the report
			// describes the render that actually happens rather than the settings
			// that were asked for. It is session state, never project state: a
			// report describes a delivery and must not join the document it describes.
			// Not published yet: everything between here and the render can still end
			// the delivery without producing anything — a dismissed save dialog most of
			// all — and publishing then would open the report surface on a delivery that
			// never ran, over the report of the last one that did.
			const plannedReport = createDeliveryReportForPlan(plan, {
				sampleRate: exportProject.sampleRate,
			});
			exportProject = inheritTrackFolderMediaStateProjectionV12(
				exportProject, createSpatialExportRenderProject(exportProject, plan),
			);
			const directStemTemporaryBytes = directStemArchiveTemporaryBytes(plan);
			const directCompressedTemporaryBytes = directCompressedStagingTemporaryBytes(plan);
			const stemPreparation = await prepareDirectStemArchiveDestination(
				fileService, plan,
				{ ...(requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : {}), confirmFileSizeWarning: options.confirmFileSizeWarning },
				abort.signal,
			);
			if (stemPreparation.cancelled) return stemPreparation.cancelled;
			pendingDirectDestination = stemPreparation.destination;
			directStemArchive = Boolean(pendingDirectDestination);
			if (!pendingDirectDestination) {
				const compressedPreparation = await prepareDirectCompressedDestination(
					fileService, plan,
					{ ...(requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : {}), confirmFileSizeWarning: options.confirmFileSizeWarning },
					abort.signal,
				);
				if (compressedPreparation.cancelled) return compressedPreparation.cancelled;
				pendingDirectDestination = compressedPreparation.destination;
				directCompressed = Boolean(pendingDirectDestination);
			}
			if (!pendingDirectDestination) {
				const directPreparation = await prepareDirectPcmExportDestination(
					fileService, plan,
					{ ...(requestedSettings && typeof requestedSettings === 'object' ? requestedSettings : {}), confirmFileSizeWarning: options.confirmFileSizeWarning },
					abort.signal,
				);
				if (directPreparation.cancelled) return directPreparation.cancelled;
				pendingDirectDestination = directPreparation.destination;
			}
			if (directStemArchive) {
				if (directStemTemporaryBytes === null) throw new Error('The direct stem archive plan changed before rendering.');
				await preflightStorage(directStemTemporaryBytes, 'export');
			} else if (!pendingDirectDestination || directCompressed) {
				await preflightStorage(
					directCompressed
						? Math.max(plan.requiredTemporaryBytes ?? 0, directCompressedTemporaryBytes ?? 0)
						: plan.requiredTemporaryBytes ?? plan.outputBytesPerRender * Math.max(1, plan.outputs.length),
					'export',
				);
			}
			// The delivery is committed to rendering: from here a failure has
			// something to describe, so the report becomes the session's.
			state.deliveryReport = plannedReport;
			setLocalizedStatus(setStatus, copy, "rendering");
			let blob: Blob | null = null;
			let fileName;
			let outputCleanup = null;
			let directOutput = null;
			let stemConformance: readonly DeliveryConformanceFinding[] = [];
			if (plan.mode === 'mix') {
				let encoded: RuntimeValue;
				try {
					encoded = await renderAndEncode(
						exportProject, plan, settings, abort.signal, exportRenderSources,
						plan.outputs[0],
						{ start: 0, end: 1 },
						directCompressed ? null : pendingDirectDestination as DirectPcmDestination | null,
						directCompressed ? pendingDirectDestination as DirectCompressedDestination : null,
						assertExportCurrent,
					);
				} catch (error) {
					// A desktop compressed target is chosen when FFmpeg opens the sink,
					// so a dismissed save dialog arrives here rather than before the
					// render, and ends the delivery instead of failing it.
					const cancellation = directCompressed ? directCompressedCancellation(error) : null;
					if (!cancellation) throw error;
					pendingDirectDestination = null;
					return cancellation;
				}
				// Registered the moment the render has staged something, because
				// everything between here and publication can throw: conformance can
				// fail the delivery, and a cancel can land during the reopen. Anything
				// registered after those would leave the staging file — up to the full
				// size of the export — stranded in origin storage with no owner.
				if (!encoded.directDestination) {
					outputCleanup = encoded.cleanup || null;
					pendingCleanup = outputCleanup;
				}
				// Conformance runs on every delivery, from the bytes that delivery
				// produced, before anything is published — it is not a verification
				// mode somebody has to remember to run.
				const conformance = await conformDeliveredExport(plan, encoded);
				assertExportCurrent();
				state.deliveryReport = conformedDeliveryReport({
					plan, sampleRate: exportProject.sampleRate, conformance,
					loudness: encoded.loudnessNormalization,
					deliveredLoudness: encoded.deliveredLoudness,
				}) ?? state.deliveryReport;
				// The report is published first, so a delivery that failed its own
				// conformance can still say why.
				assertDeliveryConformance(conformance);
				if (encoded.directDestination) directOutput = encoded;
				else blob = await prepareAudioExportBlob(encoded, 'Audio export', browserMaximumOutputBytes, { signal: abort.signal, assertCurrent: assertExportCurrent, confirmFileSizeWarning: options.confirmFileSizeWarning });
				fileName = plan.outputs[0].fileName;
			} else if (directStemArchive) {
				if (!plan.archive) throw new Error('The stem export plan has no archive descriptor.');
				const streamed = await executeDirectStemRenderArchive({
					destination: pendingDirectDestination as DirectPcmDestination, plan, snapshot: exportProject, settings, renderSources: exportRenderSources,
					signal: abort.signal, assertCurrent: assertExportCurrent, getPerformanceOptimizationMode: runtime.getPerformanceOptimizationMode,
				preflightStorage, stemProject, presentation: { task: progressTask, assertCurrent: assertExportCurrent, reportProgress: updateExportProgress, setStatus },
				resources: { suppliedSnapshotRenderer: suppliedExportSnapshotRenderer, snapshot: { options, sourceBuffers, taskProgress, createCacheAwareRenderEngine, prepareCommittedTimePitchCaches, throwIfAborted, updateExportProgress },
						realtime: { ...runtime, withRenderProgress }, normalizeProjectSampleRate,
						encoding: { applyMediaChannelMapping, audioBufferChannels, copy, createAiffStreamEncoder, createWavStreamEncoder, encodeAiff, encodeWav, ffmpeg, resampleBuffer, setStatus, throwIfAborted, confirmFileSizeWarning: options.confirmFileSizeWarning } },
					renderSequential: (snapshot, output, index) => renderAndEncode(snapshot, plan, settings, abort.signal, exportRenderSources, output,
						{ start: index / plan.outputs.length, end: (index + 1) / plan.outputs.length }, null, null, assertExportCurrent),
					conformSequential: conformDeliveredExport,
				});
				directOutput = streamed.result; stemConformance = streamed.conformance;
				fileName = plan.archive.fileName;
			} else {
				const archived = await streamStemArchiveExport({
					abortSignal: abort.signal,
					admitOutputBytes: browserMaximumOutputBytes, confirmFileSizeWarning: options.confirmFileSizeWarning,
					conformExport: conformDeliveredExport,
					copy,
					createStreamingStemArchive,
					exportProject,
					exportRenderSources,
					plan,
					renderAndEncode,
					reportProgress: updateExportProgress,
					settings,
					stemProject,
					throwIfAborted,
				});
				stemConformance = archived.conformance;
				outputCleanup = archived.cleanup;
				pendingCleanup = outputCleanup;
				blob = archived.blob;
				fileName = archived.fileName;
			}
			if (stemConformance.length > 0) {
				// Same rule the mix branch follows: the report is rebuilt with what the
				// delivery found, and published before the failure is thrown.
				state.deliveryReport = conformedDeliveryReport({
					plan, sampleRate: exportProject.sampleRate, conformance: stemConformance,
				}) ?? state.deliveryReport;
				assertDeliveryConformance(stemConformance);
			}
			assertExportCurrent();
			if (directOutput) {
				const published = directStemArchive
					? await commitPreparedDirectStemArchiveDestination(
						pendingDirectDestination as DirectPcmDestination, plan, directOutput.byteLength, assertExportCurrent,
					)
					: directCompressed
						? await commitDirectCompressedDestination(
							pendingDirectDestination as DirectCompressedDestination, plan, directOutput.byteLength, assertExportCurrent,
						)
					: await commitDirectPcmDestination(
						pendingDirectDestination as DirectPcmDestination, plan.outputFileBytesPerRender, directOutput.byteLength,
						assertExportCurrent, directPcmContainerLabel(plan.format),
					);
				pendingDirectDestination = null;
				const result = Object.freeze({
					url: null,
					fileName: published.fileName || fileName,
					mimeType: directOutput.mimeType,
					size: published.size,
					method: published.method,
				});
				try { assertExportCurrent(); } catch { return result; }
				const priorFailure = await retirePreviousExportOutput(state);
				try { assertExportCurrent(); } catch { return result; }
				state.exportOutput = result;
				if (!reportExportOutputFailure(priorFailure, handleError)) setLocalizedStatus(setStatus, copy, "done", undefined, 'success');
				publishDocumentSnapshot();
				return result;
			}
			blob = admitAudioExportBlob(blob, 'Audio export', Math.max(1, blob?.size ?? 0));
			const published = await publishBufferedExport(fileService, {
				...audioExportPublicationProgress(progressTask, copy.save, abort.signal, { key: 'save' }),
				purpose: 'audio', suggestedName: fileName,
				mimeType: blob.type || 'application/octet-stream',
				blob, target: requestedSettings?.saveTarget,
			}, requestedSettings?.saveToFile);
			if (abort.signal.aborted || generation !== state.exportGeneration || state.disposed) {
				await published.cleanup?.();
				await outputCleanup?.();
				pendingCleanup = null;
				throw abortError();
			}
			if (published.cancelled) {
				await outputCleanup?.();
				pendingCleanup = null;
				return published;
			}
			const publishedCleanup = async () => {
				await published.cleanup?.();
				await outputCleanup?.();
			};
			pendingCleanup = publishedCleanup;
			const priorFailure = await retirePreviousExportOutput(state);
			assertExportCurrent();
			state.outputCleanup = publishedCleanup;
			pendingCleanup = null;
			state.outputUrl = published.url || null;
			state.exportOutput = Object.freeze({
				url: state.outputUrl,
				fileName: published.fileName || fileName,
				mimeType: blob.type || 'application/octet-stream',
				size: blob.size,
				method: published.method,
			});
			if (!reportExportOutputFailure(priorFailure, handleError)) setLocalizedStatus(setStatus, copy, "done", undefined, 'success');
			publishDocumentSnapshot();
			return state.exportOutput;
		} catch (error) {
			await handleExportFailure({
				error, destination: pendingDirectDestination, cleanup: pendingCleanup,
				cleanupFailureMessage: 'The streamed audio export and destination cleanup both failed.',
				handleError,
			});
		} finally {
			exportOperation.finish(progressTask);
		}
	}

	async function renderAndEncode(
		snapshot: RuntimeValue, plan: RuntimeValue, settings: RuntimeValue, signal: RuntimeValue,
		renderSources: ExportRenderSources,
		renderTarget: RuntimeValue,
		progressRange: RuntimeValue = { start: 0, end: 1 },
		directDestination: DirectPcmDestination | null = null,
		directCompressedDestination: DirectCompressedDestination | null = null,
		assertDirectCurrent: () => void = () => undefined,
	): Promise<RuntimeValue> {
		return renderAndEncodeAudioExport({
			encodingRuntime: {
				applyMediaChannelMapping, audioBufferChannels, copy,
				createAiffStreamEncoder, createWavStreamEncoder, encodeAiff, encodeWav,
				ffmpeg, resampleBuffer, setStatus, throwIfAborted, confirmFileSizeWarning: options.confirmFileSizeWarning,
			},
			normalizeProjectSampleRate,
			renderRealtimeEncoded,
			renderSnapshot,
			taskProgress,
		}, {
			assertDirectCurrent,
			directCompressedDestination,
			directDestination,
			plan,
			progressRange,
			renderSources,
			renderTarget,
			settings,
			signal,
			snapshot,
		});
	}


	return Object.freeze({
		exportVideo,
		handleExportAction,
		renderSnapshot,
	});
}
