/* SPDX-License-Identifier: AGPL-3.0-only */

#include <set>

#define OfxGetPlugin ConformanceGetPlugin
#include "../../native/framescaper-openfx-host/fixtures/conformance_plugin.cpp"
#undef OfxGetPlugin

#ifndef kOfxKey_Shift_L
#define kOfxKey_Shift_L 0xFFE1
#define kOfxKey_Shift_R 0xFFE2
#define kOfxKey_Control_L 0xFFE3
#define kOfxKey_Control_R 0xFFE4
#define kOfxKey_Meta_L 0xFFE7
#define kOfxKey_Meta_R 0xFFE8
#define kOfxKey_Alt_L 0xFFE9
#define kOfxKey_Alt_R 0xFFEA
#endif

namespace {
std::set<int> held_modifiers;

bool modifier_key(int key) {
	return key == kOfxKey_Shift_L || key == kOfxKey_Shift_R
		|| key == kOfxKey_Control_L || key == kOfxKey_Control_R
		|| key == kOfxKey_Alt_L || key == kOfxKey_Alt_R
		|| key == kOfxKey_Meta_L || key == kOfxKey_Meta_R;
}

OfxStatus modifier_interact(const char* action, const void* handle,
	OfxPropertySetHandle input, OfxPropertySetHandle output) {
	if (std::strcmp(action, kOfxActionCreateInstance) == 0) held_modifiers.clear();
	if (std::strcmp(action, kOfxInteractActionKeyDown) == 0
		|| std::strcmp(action, kOfxInteractActionKeyUp) == 0) {
		int key = 0;
		if (properties->propGetInt(input, kOfxPropKeySym, 0, &key) != kOfxStatOK) return kOfxStatFailed;
		if (modifier_key(key)) {
			if (std::strcmp(action, kOfxInteractActionKeyDown) == 0) held_modifiers.insert(key);
			else held_modifiers.erase(key);
			return kOfxStatOK;
		}
	}
	// Hovering an already-focused canvas is legal before the drag begins.
	const auto state = interact_sequence_state(handle);
	if (std::strcmp(action, kOfxInteractActionPenMotion) == 0
		&& state != interact_sequence_states.end() && state->stage == 1) return kOfxStatReplyDefault;
	if (std::strcmp(action, kOfxInteractActionPenDown) == 0 && held_modifiers.empty()) return kOfxStatFailed;
	if (std::strcmp(action, kOfxInteractActionLoseFocus) == 0 && !held_modifiers.empty()) return kOfxStatFailed;
	if (std::strcmp(action, kOfxInteractActionDraw) == 0
		&& state != interact_sequence_states.end() && state->stage == 4) {
		void* effect = nullptr;
		OfxParamSetHandle set = nullptr;
		OfxParamHandle parameter = nullptr;
		if (properties->propGetPointer(input, kOfxPropEffectInstance, 0, &effect) != kOfxStatOK
			|| images->getParamSet(reinterpret_cast<OfxImageEffectHandle>(effect), &set) != kOfxStatOK
			|| parameters->paramGetHandle(set, "parameter0", &parameter, nullptr) != kOfxStatOK
			|| parameters->paramSetValue(parameter, held_modifiers.empty() ? 7 : 8) != kOfxStatOK) return kOfxStatFailed;
	}
	return overlay_interact(action, handle, input, output);
}

OfxStatus modifier_entry(const char* action, const void* handle,
	OfxPropertySetHandle input, OfxPropertySetHandle output) {
	const auto status = entry(action, handle, input, output);
	if (status != kOfxStatOK || std::strcmp(action, kOfxActionDescribe) != 0) return status;
	OfxPropertySetHandle effect_properties = nullptr;
	if (images->getPropertySet(reinterpret_cast<OfxImageEffectHandle>(const_cast<void*>(handle)),
		&effect_properties) != kOfxStatOK) return kOfxStatFailed;
	return properties->propSetPointer(effect_properties, kOfxImageEffectPluginPropOverlayInteractV2,
		0, reinterpret_cast<void*>(modifier_interact));
}
} // namespace

FRAMESCAPER_EXPORT OfxPlugin* OfxGetPlugin(int index) {
	auto* result = ConformanceGetPlugin(index);
	if (result != nullptr) result->mainEntry = modifier_entry;
	return result;
}
