/* SPDX-License-Identifier: AGPL-3.0-only */

#define OfxGetPlugin ConformanceGetPlugin
#include "../../native/framescaper-openfx-host/fixtures/conformance_plugin.cpp"
#undef OfxGetPlugin

namespace {
OfxStatus repeat_interact(const char* action, const void* handle,
	OfxPropertySetHandle input, OfxPropertySetHandle output) {
	if (std::strcmp(action, kOfxInteractActionGainFocus) == 0) {
		const auto state = interact_sequence_state(handle);
		if (state != interact_sequence_states.end()) state->stage = 0;
	}
	if (std::strcmp(action, kOfxInteractActionLoseFocus) == 0) {
		const auto state = interact_sequence_state(handle);
		if (state != interact_sequence_states.end()) state->stage = 6;
	}
	const bool down = std::strcmp(action, kOfxInteractActionKeyDown) == 0;
	const bool repeat = std::strcmp(action, kOfxInteractActionKeyRepeat) == 0;
	if (down || repeat || std::strcmp(action, kOfxInteractActionKeyUp) == 0) {
		int key = 0;
		if (properties->propGetInt(input, kOfxPropKeySym, 0, &key) != kOfxStatOK) return kOfxStatFailed;
		if (key != kOfxKey_Right || (!down && !repeat)) return kOfxStatReplyDefault;
		void* effect = nullptr;
		OfxParamSetHandle set = nullptr;
		OfxParamHandle parameter = nullptr;
		int value = 0;
		if (properties->propGetPointer(input, kOfxPropEffectInstance, 0, &effect) != kOfxStatOK
			|| images->getParamSet(reinterpret_cast<OfxImageEffectHandle>(effect), &set) != kOfxStatOK
			|| parameters->paramGetHandle(set, "parameter0", &parameter, nullptr) != kOfxStatOK
			|| parameters->paramGetValue(parameter, &value) != kOfxStatOK
			|| parameters->paramSetValue(parameter, value + (repeat ? 10 : 1)) != kOfxStatOK) return kOfxStatFailed;
		return interacts->interactRedraw(reinterpret_cast<OfxInteractHandle>(const_cast<void*>(handle)));
	}
	return overlay_interact(action, handle, input, output);
}

OfxStatus repeat_entry(const char* action, const void* handle,
	OfxPropertySetHandle input, OfxPropertySetHandle output) {
	const auto status = entry(action, handle, input, output);
	if (status != kOfxStatOK || std::strcmp(action, kOfxActionDescribe) != 0) return status;
	OfxPropertySetHandle properties_handle = nullptr;
	if (images->getPropertySet(reinterpret_cast<OfxImageEffectHandle>(const_cast<void*>(handle)), &properties_handle) != kOfxStatOK) return kOfxStatFailed;
	return properties->propSetPointer(properties_handle, kOfxImageEffectPluginPropOverlayInteractV2,
		0, reinterpret_cast<void*>(repeat_interact));
}
} // namespace

FRAMESCAPER_EXPORT OfxPlugin* OfxGetPlugin(int index) {
	auto* result = ConformanceGetPlugin(index);
	if (result != nullptr) result->mainEntry = repeat_entry;
	return result;
}
