/* SPDX-License-Identifier: AGPL-3.0-only */

const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);

const COMMON_CONFIG_FILES = Object.freeze([
	'config/assistance-native-runtime-manifest.json',
	'config/assistance-sherpa-gpu-build.json',
	'config/assistance-sherpa-retained-builds.json',
	'config/assistance-runtime-family-supply-candidates.json',
	'config/assistance-runtime-distribution.json',
	'config/assistance-kokoro-g2p-runtime-manifest.json',
	'config/local-model-catalog.json',
	'config/milestone-5-native-source-acquisitions.json',
	'config/native-addon-payload-manifest.json',
	'config/production-licensing-matrix.json',
]);

const PRODUCT_CONFIG_FILES = Object.freeze({
	soundscaper: Object.freeze([
		...COMMON_CONFIG_FILES,
		'config/yabridge-native-payload.json',
		'config/soundscaper-professional-native-notices.json',
		'config/soundscaper-professional-native-payload-manifest.json',
	]),
	framescaper: Object.freeze([
		...COMMON_CONFIG_FILES,
		'config/soundscaper-professional-native-notices.json',
		'config/framescaper-media-host-payload-manifest.json',
		'config/framescaper-openfx-host-payload-manifest.json',
		'config/soundscaper-professional-native-payload-manifest.json',
	]),
});

const SOUNDSCAPER_FORBIDDEN_PATH = /(?:^|\/)(?:src\/framescaper\/|[^/]*framescaper[^/]*|[^/]*(?:openfx|ofx)[^/]*|helper-probe[^/]*|native-services[^/]*|native-media-helper-process|external-display[^/]*|assistance-(?:external-ffmpeg-(?:shot-runtime|video-materializer)|selected-video-authority|workflow-owned-video-highlight[^/]*)|framescaper-capture-sandbox-preload\.cjs|framescaper-web-vcr-sandbox-preload\.cjs)(?:\/|$|\.)/iu;
const SOUNDSCAPER_DEFERRED_VISUAL_PATH = /(?:^|\/)(?:(?:desktop\/)?(?:desktop-video[^/]*|external-ffmpeg-(?:shot|video)[^/]*|linked-video[^/]*|native-media[^/]*|video-timing[^/]*)|desktop\/assistance-[^/]*(?:frame|shot|video|visual)[^/]*|src\/common\/editor\/(?:assistance\/(?:owned-video|reframe|shot|visual-frame)[^/]*|commands\/video-[^/]*|frame-[^/]*|native-(?:external-display|media|ofx)[^/]*|sequence-frame[^/]*|video-(?:export|ffmpeg|keyframe-(?:encoder|execution|export|webcodecs)|webcodecs)[^/]*|web-vcr-[^/]*))(?:\/|$|\.)/iu;
const SOUNDSCAPER_FORBIDDEN_CONFIG = /(?:^|\/)config\/framescaper-(?:media|openfx)-host-payload-manifest\.json$/u;
const SOUNDSCAPER_FORBIDDEN_CONTENT = /(?:framescaperDesktop|framescaper:v1:(?:native-services|capture)|FRAMESCAPER_WEB_VCR_|framescaper-(?:capture|web-vcr)-sandbox-preload)/u;
const SOUNDSCAPER_SHARED_RUNTIME_EXCEPTIONS = new Set([
	'src/common/editor/native-media-plan-canonical-form.js',
	'src/common/editor/video-timing-asset-reference.js',
]);
const SOUNDSCAPER_SHARED_VIDEO_RUNTIME = /^src\/common\/editor\/video-[^/]+\.js$/u;
const NIGHTLY_TEST_LAUNCHER_FILES = new Set([
	'nightly-tests-assistance-host.mjs',
	'nightly-tests-editor-host.mjs',
	'nightly-tests-assistance.html',
	'nightly-tests-main.mjs',
	'nightly-tests-manifest.mjs',
	'nightly-tests-progress-renderer.js',
	'nightly-tests-progress-window.d.mts',
	'nightly-tests-progress-window.mjs',
	'nightly-tests-progress.css',
	'nightly-tests-progress.html',
]);
const DESKTOP_RENDERER_ONLY_SOURCE_FILES = new Set([
	'desktop-chrome-renderer-smoke.js',
	'direct-wav-renderer-smoke.js',
	'framescaper-baseline-artifact-renderer-smoke.js',
	'framescaper-capture-artifact-renderer-smoke.js',
	'framescaper-web-vcr-renderer-runner.js',
	'project-library-lease-renderer-smoke.js',
	'renderer-smoke-runtime-framescaper.js',
	'renderer-smoke-runtime.js',
	'renderer-smoke-runtime-soundscaper.js',
	'scape-open-renderer-smoke.js',
	'scape-reopen-renderer-smoke.js',
	'video-timing-probe-renderer-smoke.js',
]);
const DESKTOP_RETIRED_SOURCE_FILES = new Set([
	'native-helper-realtime-job.js',
]);
const SOUNDSCAPER_REPLACED_SOURCE_FILES = new Set([
	'main.mjs',
	'preload.mjs',
	'desktop-smoke.js',
	'desktop-smoke-configuration.js',
	'direct-wav-smoke.js',
	'file-capabilities.js',
	'main-file-capability-ipc.mjs',
	'native-audio-device-job.js',
	'native-audio-helper-process.js',
	'native-audio-helper-registration.mjs',
	'native-helper-persistent-audio-job.js',
	'native-tier-registration.mjs',
	'project-library-lease-smoke.js',
	'project-library-product-runtime.js',
	'renderer-ownership-cleanup.js',
	'renderer-save-owner.js',
	'renderer-smoke-execution.js',
	'scape-open-smoke.js',
	'scape-reopen-smoke.js',
	'helper-registration.mjs',
	'soundscaper-delivery-registration.mjs',
	'soundscaper-delivery-restart-smoke.mjs',
	'soundscaper-professional-native-utility-smoke.mjs',
	'soundscaper-project-library-sandbox-preload.cjs',
]);
const SOUNDSCAPER_RUNTIME_PACKAGE_IMPORTS = new Set([
	'#desktop-runtime/bundled-native-plugins', '#desktop-runtime/bundled-plugin-resources',
	'#desktop-runtime/bundled-plugin-factory-data', '#desktop-runtime/plugin-midi-events',
	'#desktop-runtime/helper-contract',
]);

export function desktopProductConfigFiles(productIdValue, metadata = null) {
	const productId = desktopPackageProduct(productIdValue);
	return desktopLegacyNativeAddonIncluded(productId, metadata)
		? PRODUCT_CONFIG_FILES[productId]
		: Object.freeze(PRODUCT_CONFIG_FILES[productId].filter((path) => (
			path !== 'config/native-addon-payload-manifest.json'
		)));
}

export function desktopLegacyNativeAddonIncluded(productIdValue, metadata = null) {
	const productId = desktopPackageProduct(productIdValue);
	return productId !== 'soundscaper'
		|| metadata?.applicationVersionChannel !== 'stable'
		|| metadata?.releaseChannel !== 'stable';
}

export function desktopProductRuntimeFiles(productIdValue, filesValue) {
	const productId = desktopPackageProduct(productIdValue);
	const files = exactFileInventory(filesValue, 'compiled desktop runtime')
		.filter((path) => !isNightlyTestLauncherPath(path));
	if (productId === 'framescaper') return Object.freeze([...files]);
	return Object.freeze(files.filter((path) => !soundscaperForbiddenPackagePath(path)));
}

export function desktopProductRuntimePackageImports(productIdValue, importsValue) {
	const productId = desktopPackageProduct(productIdValue);
	if (!importsValue || typeof importsValue !== 'object' || Array.isArray(importsValue)) {
		throw new TypeError('Desktop runtime package imports are invalid.');
	}
	return Object.freeze(Object.fromEntries(Object.entries(importsValue).filter(([alias, target]) => (
		productId === 'framescaper'
			|| SOUNDSCAPER_RUNTIME_PACKAGE_IMPORTS.has(alias)
			&& typeof target === 'string' && !soundscaperForbiddenPackagePath(
				target.replace(/^\.\/desktop\/project-library-runtime\//u, ''),
			)
	))));
}

export function desktopProductSourceIncluded(productIdValue, relativePathValue) {
	const productId = desktopPackageProduct(productIdValue);
	const relativePath = packagePath(relativePathValue, 'desktop application source');
	if (DESKTOP_RENDERER_ONLY_SOURCE_FILES.has(relativePath) || DESKTOP_RETIRED_SOURCE_FILES.has(relativePath)
		|| isNightlyTestLauncherPath(relativePath)) return false;
	if (productId === 'framescaper' && relativePath.startsWith('tracktion-')) return false;
	return productId === 'framescaper' || !soundscaperForbiddenPackagePath(relativePath)
		&& !SOUNDSCAPER_REPLACED_SOURCE_FILES.has(relativePath);
}

export function assertDesktopProductPackageIsolation(productIdValue, filesValue, contentByPath = new Map()) {
	const productId = desktopPackageProduct(productIdValue);
	const files = exactFileInventory(filesValue, 'desktop package');
	const harness = files.filter((path) => isNightlyTestLauncherPath(path));
	if (harness.length > 0) {
		throw new Error(`Desktop product package contains nightly-test harness files: ${harness.join(', ')}`);
	}
	if (productId === 'framescaper') return;
	const forbidden = files.filter((path) => soundscaperForbiddenPackagePath(path)
		|| SOUNDSCAPER_FORBIDDEN_CONFIG.test(path));
	if (forbidden.length > 0) {
		throw new Error(`Soundscaper package contains Framescaper-owned files: ${forbidden.join(', ')}`);
	}
	for (const [pathValue, source] of contentByPath) {
		const path = packagePath(pathValue, 'desktop package content');
		if (!files.includes(path) || typeof source !== 'string') {
			throw new TypeError('Desktop package content audit must bind an inventoried text file.');
		}
		const marker = SOUNDSCAPER_FORBIDDEN_CONTENT.exec(source)?.[0];
		if (marker !== undefined) {
			throw new Error(`Soundscaper package contains a callable Framescaper marker ${marker} in ${path}.`);
		}
	}
}

function isNightlyTestLauncherPath(path) {
	return NIGHTLY_TEST_LAUNCHER_FILES.has(path.replace(/^desktop\//u, ''));
}

export function soundscaperConstantsSource(sourceValue) {
	let source = textSource(sourceValue, 'desktop constants');
	source = replaceRange(source, 'export const PRODUCT_ID',
		'export const SETTINGS_SCHEMA_VERSION = 1;', [
			"export const PRODUCT_ID = 'soundscaper';",
			'const PRODUCT_METADATA_MATCHES = [1, 2].includes(productConfig.schemaVersion) && productConfig.id === PRODUCT_ID;',
			'export const DECLARED_APPLICATION_VERSION = PRODUCT_METADATA_MATCHES ? productConfig.applicationVersion : null;',
			'export const DECLARED_PACKAGE_VERSION = PRODUCT_METADATA_MATCHES ? productConfig.packageVersion ?? productConfig.applicationVersion : null;',
			"export const APPLICATION_VERSION_CHANNEL = PRODUCT_METADATA_MATCHES ? productConfig.applicationVersionChannel : 'candidate';",
			"export const RELEASE_CHANNEL = PRODUCT_METADATA_MATCHES ? productConfig.releaseChannel : 'candidate';",
			"export const APP_NAME = 'Soundscaper';",
			"export const APP_ID = 'org.soundscaper.desktop';",
			"export const APP_SCHEME = 'soundscaper-app';",
			"export const APP_HOST = 'bundle';",
			'export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;',
			"export const SESSION_PARTITION = 'persist:soundscaper-production';",
			"export const UPDATE_TAG_PREFIX = PRODUCT_METADATA_MATCHES ? productConfig.updateTagPrefix : 'soundscaper-v';",
			'export const SETTINGS_SCHEMA_VERSION = 1;',
		].join('\n'), 'desktop product constants');
	source = replaceOnce(source,
		"export const PROJECT_FILE_EXTENSION = PRODUCT_ID === 'framescaper' ? '.fscape' : '.sscape';",
		"export const PROJECT_FILE_EXTENSION = '.sscape';", 'desktop project extension');
	source = replaceRange(source, '\n\tchooseLinkedVideoOriginal:', '\n\tchooseLinkedAudioOriginal:',
		'\n\tchooseLinkedAudioOriginal:', 'linked-video IPC constants');
	source = replaceRange(source, '\n\thelperProbeAvailability:', '\n\tnativeAudioAvailability:',
		'\n\tnativeAudioAvailability:', 'video probe IPC constants');
	source = replaceRange(source, '\n\tframescaperNativeCapabilities:', '\n\tlistAssistanceModels:',
		'\n\tlistAssistanceModels:', 'Framescaper IPC constants');
	source = replaceRange(source, '\n\tdesktopVideoCodecCapabilities:', '\n\tsetLocale:',
		'\n\tsetLocale:', 'desktop video IPC constants');
	return source;
}

export function soundscaperDesktopCodecSource(sourceValue) {
	let source = textSource(sourceValue, 'desktop codec integration');
	source = replaceOnce(source,
		"import { registerDesktopVideoCodecs } from './desktop-video-codec-registration.mjs';\n",
		'', 'desktop video codec import');
	source = replaceOnce(source,
		'\tconst registerVideo = dependencies.registerVideoCodecs ?? registerDesktopVideoCodecs;\n',
		'', 'desktop video codec dependency');
	source = replaceOnce(source,
		"\tif (typeof registerAudio !== 'function' || typeof registerVideo !== 'function') {",
		"\tif (typeof registerAudio !== 'function') {", 'desktop codec dependency validation');
	source = replaceOnce(source,
		"\t\tproviders.push(validateProvider(await registerVideo(options), 'video'));\n",
		'', 'desktop video codec registration');
	return source;
}

export function soundscaperProtocolSource(sourceValue) {
	let source = textSource(sourceValue, 'desktop protocol');
	source = replaceOnce(source,
		"const FRAMESCAPER_CAPTURE_POLICY =\n\t'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(self), geolocation=()';\n",
		'', 'Framescaper protocol capture policy');
	source = replaceOnce(source,
		"\tif (productId !== 'soundscaper' && productId !== 'framescaper') {",
		"\tif (productId !== 'soundscaper') {", 'desktop protocol product validation');
	source = replaceOnce(source,
		"\tif (productId === 'framescaper') return FRAMESCAPER_CAPTURE_POLICY;\n",
		'', 'Framescaper protocol policy selection');
	return source;
}

export function soundscaperAssistanceRegistrationSource(sourceValue) {
	let source = textSource(sourceValue, 'assistance registration');
	for (const pattern of [
		/import \{ createExternalFfmpegAssistanceShotRuntimeAdapter \} from '[^']+';\n/u,
		/import \{ createExternalFfmpegAssistanceVideoMaterializer \} from '[^']+';\n/u,
		/import \{ createAssistanceWorkflowOwnedVideoHighlightStageRuntime \} from '[^']+';\n/u,
		/import \{ createAssistanceKeyedVideoService \} from '[^']+';\n/u,
		/import \{ createAssistanceNativeKeyedVideoEncoder \} from '[^']+';\n/u,
	]) source = replaceOnce(source, pattern, '', 'deferred visual assistance import');
	source = replaceOnce(source,
		/\tconst shotDetectionRuntime = createExternalFfmpegAssistanceShotRuntimeAdapter\(\{\n\t\tpreferences: externalFfmpegPreferences,\n\t\}\);\n/u,
		'', 'deferred shot-detection runtime');
	source = replaceOnce(source, '\t\t\tshotDetectionRuntime,\n', '',
		'deferred shot-detection operation');
	source = replaceRange(source, '\t\tcreateKeyedVideo:', '\t\tconfirmOperation:',
		'\t\tconfirmOperation:', 'deferred keyed-video encoder factory');
	source = replaceRange(source,
		'\tconst videoMaterializer =',
		'\tconst workflowExecute =',
		'\tconst deterministicHandlers = Object.freeze({ ...audioCutHandlers });\n\tconst workflowExecute =',
		'deferred visual assistance workflow');
	return source;
}

function soundscaperForbiddenPackagePath(path) {
	const runtimePath = path.replace(/^(?:desktop\/)?project-library-runtime\//u, '');
	if (SOUNDSCAPER_SHARED_RUNTIME_EXCEPTIONS.has(runtimePath)
		|| SOUNDSCAPER_SHARED_VIDEO_RUNTIME.test(runtimePath)) return false;
	return SOUNDSCAPER_FORBIDDEN_PATH.test(path) || SOUNDSCAPER_DEFERRED_VISUAL_PATH.test(path)
		|| SOUNDSCAPER_FORBIDDEN_CONFIG.test(path);
}

function desktopPackageProduct(value) {
	if (!PRODUCT_IDS.includes(value)) throw new TypeError('Desktop package product is unsupported.');
	return value;
}

function exactFileInventory(value, label) {
	if (!Array.isArray(value) || value.some((path) => typeof path !== 'string')
		|| new Set(value).size !== value.length) throw new TypeError(`${label} file inventory is invalid.`);
	return value.map((path) => packagePath(path, label));
}

function packagePath(value, label) {
	if (typeof value !== 'string' || value.length === 0 || value.startsWith('/')
		|| value.includes('\\') || value.split('/').includes('..')) {
		throw new TypeError(`${label} path is invalid.`);
	}
	return value;
}

function textSource(value, label) {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} source is invalid.`);
	return value.replaceAll('\r\n', '\n');
}

function replaceRange(source, start, end, replacement, label) {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	if (startIndex < 0 || endIndex < 0) throw new Error(`Cannot isolate ${label}.`);
	return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex + end.length)}`;
}

function replaceOnce(source, pattern, replacement, label) {
	if (typeof pattern === 'string') {
		if (source.indexOf(pattern) < 0 || source.indexOf(pattern) !== source.lastIndexOf(pattern)) {
			throw new Error(`Cannot isolate ${label}.`);
		}
		return source.replace(pattern, replacement);
	}
	const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
	if (matches?.length !== 1) throw new Error(`Cannot isolate ${label}.`);
	return source.replace(pattern, replacement);
}
