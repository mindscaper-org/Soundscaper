/* SPDX-License-Identifier: AGPL-3.0-only */

// Reuse the authenticated conformance plug-in, adding a pressure-sensitive
// interact. No production host, ABI, or plug-in distribution changes.
#define OfxGetPlugin ConformanceGetPlugin
#include "../../native/framescaper-openfx-host/fixtures/conformance_plugin.cpp"
#undef OfxGetPlugin

namespace {

OfxStatus pressure_interact(const char* action, const void* handle,
	OfxPropertySetHandle input, OfxPropertySetHandle output) {
	// OpenFX 1.5.1 maps a mouse's pressed/released states to pressure 1/0.
	// https://openfx.readthedocs.io/en/latest/Reference/api/file/ofxInteract_8h.html
	const bool pressed = std::strcmp(action, kOfxInteractActionPenDown) == 0
		|| std::strcmp(action, kOfxInteractActionPenMotion) == 0;
	if (pressed || std::strcmp(action, kOfxInteractActionPenUp) == 0) {
		double pressure = -1;
		if (properties->propGetDouble(input, kOfxInteractPropPenPressure, 0, &pressure) != kOfxStatOK
			|| pressure != (pressed ? 1.0 : 0.0)) return kOfxStatFailed;
	}
	return overlay_interact(action, handle, input, output);
}

OfxStatus pressure_entry(const char* action, const void* handle,
	OfxPropertySetHandle input, OfxPropertySetHandle output) {
	const auto status = entry(action, handle, input, output);
	if (status != kOfxStatOK || std::strcmp(action, kOfxActionDescribe) != 0) return status;
	OfxPropertySetHandle effect_properties = nullptr;
	if (images->getPropertySet(reinterpret_cast<OfxImageEffectHandle>(const_cast<void*>(handle)),
		&effect_properties) != kOfxStatOK) return kOfxStatFailed;
	return properties->propSetPointer(effect_properties, kOfxImageEffectPluginPropOverlayInteractV2,
		0, reinterpret_cast<void*>(pressure_interact));
}

} // namespace

FRAMESCAPER_EXPORT OfxPlugin* OfxGetPlugin(int index) {
	auto* result = ConformanceGetPlugin(index);
	if (result != nullptr) result->mainEntry = pressure_entry;
	return result;
}
