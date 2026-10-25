import { readFile } from 'node:fs/promises';

import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const SOURCE_MODULES = new Map([
	['common/editor/controller/clip-video/internal/video-effect-lookup-gpu.ts', '../../src/common/editor/controller/clip-video/internal/video-effect-lookup-gpu.ts'],
	['common/editor/controller/clip-video/video-color-wheels-gpu.ts', '../../src/common/editor/controller/clip-video/video-color-wheels-gpu.ts'],
	['common/editor/controller/clip-video/video-curves-gpu.ts', '../../src/common/editor/controller/clip-video/video-curves-gpu.ts'],
	['common/editor/controller/clip-video/video-global-develop-gpu.ts', '../../src/common/editor/controller/clip-video/video-global-develop-gpu.ts'],
	['common/editor/imaging/image-geometry-plan-v1.ts', '../../src/common/editor/imaging/image-geometry-plan-v1.ts'],
	['common/editor/imaging/image-geometry-v1.ts', '../../src/common/editor/imaging/image-geometry-v1.ts'],
	['common/editor/imaging/pixel-frame-contract-v1.ts', '../../src/common/editor/imaging/pixel-frame-contract-v1.ts'],
	['common/editor/ui/video-preview-chromatic-aberration-v1.ts', '../../src/common/editor/ui/video-preview-chromatic-aberration-v1.ts'],
	['common/editor/ui/video-preview-clarity-v1.ts', '../../src/common/editor/ui/video-preview-clarity-v1.ts'],
	['common/editor/ui/video-preview-defringe-v1.ts', '../../src/common/editor/ui/video-preview-defringe-v1.ts'],
	['common/editor/ui/video-preview-dehaze-v1.ts', '../../src/common/editor/ui/video-preview-dehaze-v1.ts'],
	['common/editor/ui/video-preview-effect-parameters.ts', '../../src/common/editor/ui/video-preview-effect-parameters.ts'],
	['common/editor/ui/video-preview-grain-v1.ts', '../../src/common/editor/ui/video-preview-grain-v1.ts'],
	['common/editor/ui/video-preview-image-geometry-v1.ts', '../../src/common/editor/ui/video-preview-image-geometry-v1.ts'],
	['common/editor/ui/video-preview-lens-distortion-v1.ts', '../../src/common/editor/ui/video-preview-lens-distortion-v1.ts'],
	['common/editor/ui/video-preview-noise-reduction-v1.ts', '../../src/common/editor/ui/video-preview-noise-reduction-v1.ts'],
	['common/editor/ui/video-preview-optical-vignette-v1.ts', '../../src/common/editor/ui/video-preview-optical-vignette-v1.ts'],
	['common/editor/ui/video-preview-post-crop-vignette-v1.ts', '../../src/common/editor/ui/video-preview-post-crop-vignette-v1.ts'],
	['common/editor/ui/video-preview-sharpen-v1.ts', '../../src/common/editor/ui/video-preview-sharpen-v1.ts'],
	['common/editor/ui/video-preview-texture-v1.ts', '../../src/common/editor/ui/video-preview-texture-v1.ts'],
	['common/editor/video-black-white-mix-v1.ts', '../../src/common/editor/video-black-white-mix-v1.ts'],
	['common/editor/video-chroma-develop-v1.ts', '../../src/common/editor/video-chroma-develop-v1.ts'],
	['common/editor/video-chromatic-aberration-v1.ts', '../../src/common/editor/video-chromatic-aberration-v1.ts'],
	['common/editor/video-clarity-v1.ts', '../../src/common/editor/video-clarity-v1.ts'],
	['common/editor/video-color-wheels-scalar-v1.ts', '../../src/common/editor/video-color-wheels-scalar-v1.ts'],
	['common/editor/video-color-wheels-v1.ts', '../../src/common/editor/video-color-wheels-v1.ts'],
	['common/editor/video-curve-transfer-v1.ts', '../../src/common/editor/video-curve-transfer-v1.ts'],
	['common/editor/video-curves-v1.ts', '../../src/common/editor/video-curves-v1.ts'],
	['common/editor/video-defringe-v1.ts', '../../src/common/editor/video-defringe-v1.ts'],
	['common/editor/video-dehaze-v1.ts', '../../src/common/editor/video-dehaze-v1.ts'],
	['common/editor/video-global-develop-v1.ts', '../../src/common/editor/video-global-develop-v1.ts'],
	['common/editor/video-grain-v1.ts', '../../src/common/editor/video-grain-v1.ts'],
	['common/editor/video-hsl-mixer-v1.ts', '../../src/common/editor/video-hsl-mixer-v1.ts'],
	['common/editor/video-image-geometry-v1.ts', '../../src/common/editor/video-image-geometry-v1.ts'],
	['common/editor/video-lens-distortion-v1.ts', '../../src/common/editor/video-lens-distortion-v1.ts'],
	['common/editor/video-noise-reduction-v1.ts', '../../src/common/editor/video-noise-reduction-v1.ts'],
	['common/editor/video-optical-vignette-v1.ts', '../../src/common/editor/video-optical-vignette-v1.ts'],
	['common/editor/video-post-crop-vignette-v1.ts', '../../src/common/editor/video-post-crop-vignette-v1.ts'],
	['common/editor/video-sharpen-v1.ts', '../../src/common/editor/video-sharpen-v1.ts'],
	['common/editor/video-texture-v1.ts', '../../src/common/editor/video-texture-v1.ts'],
	['common/editor/controller/clip-video/video-preview-effect-result-cache.ts', '../../src/common/editor/controller/clip-video/video-preview-effect-result-cache.ts'],
	['common/editor/controller/clip-video/video-preview-frame-identity.ts', '../../src/common/editor/controller/clip-video/video-preview-frame-identity.ts'],
	['common/editor/controller/clip-video/video-preview-target-pool.ts', '../../src/common/editor/controller/clip-video/video-preview-target-pool.ts'],
	['common/editor/closed-domain-value.ts', '../../src/common/editor/closed-domain-value.ts'],
	['common/editor/native-external-display.ts', '../../src/common/editor/native-external-display.ts'],
	['common/editor/native-validation.ts', '../../src/common/editor/native-validation.ts'],
	['common/editor/video-clip-composition.ts', '../../src/common/editor/video-clip-composition.ts'],
	['common/editor/video-delivery-color.ts', '../../src/common/editor/video-delivery-color.ts'],
	['common/editor/video-preview-render-description.ts', '../../src/common/editor/video-preview-render-description.ts'],
	['common/editor/ui/video-preview-composition-blend.ts', '../../src/common/editor/ui/video-preview-composition-blend.ts'],
	['common/editor/ui/video-preview-compositor.js', '../../src/common/editor/ui/video-preview-compositor.js'],
	['common/editor/ui/video-preview-compositor-size.js', '../../src/common/editor/ui/video-preview-compositor-size.js'],
	['common/editor/ui/video-preview-effects.js', '../../src/common/editor/ui/video-preview-effects.js'],
	['common/editor/ui/video-preview-effects-shader.js', '../../src/common/editor/ui/video-preview-effects-shader.js'],
	['common/editor/ui/video-preview-entry-effects.js', '../../src/common/editor/ui/video-preview-entry-effects.js'],
	['common/editor/ui/video-preview-geometry-shader.ts', '../../src/common/editor/ui/video-preview-geometry-shader.ts'],
	['common/editor/ui/video-preview-layer-effects.js', '../../src/common/editor/ui/video-preview-layer-effects.js'],
	['common/editor/ui/video-preview-render-description.ts', '../../src/common/editor/ui/video-preview-render-description.ts'],
	['common/editor/ui/video-preview-render-ledger.js', '../../src/common/editor/ui/video-preview-render-ledger.js'],
	['common/editor/ui/video-preview-render-size.js', '../../src/common/editor/ui/video-preview-render-size.js'],
	['common/editor/ui/video-preview-render-target.js', '../../src/common/editor/ui/video-preview-render-target.js'],
	['common/editor/ui/video-preview-viewports.js', '../../src/common/editor/ui/video-preview-viewports.js'],
	['common/editor/ui/video-preview-video-textures.js', '../../src/common/editor/ui/video-preview-video-textures.js'],
]);

/** Serve the production preview module graph with TypeScript erased for Chromium. */
export async function videoPreviewSourceResponse(pathname, routeRoot) {
	const prefix = `${routeRoot}/source/`;
	if (!pathname.startsWith(prefix)) return null;
	const modulePath = pathname.slice(prefix.length);
	const relativePath = SOURCE_MODULES.get(modulePath);
	if (!relativePath) throw new Error(`Unregistered video preview source module ${modulePath}.`);
	const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
	const body = modulePath.endsWith('.ts')
		? transpileModule(source, {
			compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
			fileName: modulePath,
		}).outputText
		: source;
	return { body, contentType: 'text/javascript' };
}
