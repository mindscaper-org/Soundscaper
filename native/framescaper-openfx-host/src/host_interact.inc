/* SPDX-License-Identifier: AGPL-3.0-only */

namespace {
int official_interact_key_sym(const InteractEvent& event) {
	if (event.code == "NumpadEnter") return kOfxKey_KP_Enter;
	if (event.code == "ShiftLeft") return kOfxKey_Shift_L;
	if (event.code == "ShiftRight") return kOfxKey_Shift_R;
	if (event.code == "ControlLeft") return kOfxKey_Control_L;
	if (event.code == "ControlRight") return kOfxKey_Control_R;
	if (event.code == "AltLeft") return kOfxKey_Alt_L;
	if (event.code == "AltRight") return kOfxKey_Alt_R;
	if (event.code == "MetaLeft") return kOfxKey_Meta_L;
	if (event.code == "MetaRight") return kOfxKey_Meta_R;
	if (event.key == "Shift") return kOfxKey_Shift_L;
	if (event.key == "Control") return kOfxKey_Control_L;
	if (event.key == "Alt") return kOfxKey_Alt_L;
	if (event.key == "Meta") return kOfxKey_Meta_L;
	if (event.key == "Backspace") return kOfxKey_BackSpace;
	if (event.key == "Tab") return kOfxKey_Tab;
	if (event.key == "Enter") return kOfxKey_Return;
	if (event.key == "Escape") return kOfxKey_Escape;
	if (event.key == "Home") return kOfxKey_Home;
	if (event.key == "ArrowLeft") return kOfxKey_Left;
	if (event.key == "ArrowUp") return kOfxKey_Up;
	if (event.key == "ArrowRight") return kOfxKey_Right;
	if (event.key == "ArrowDown") return kOfxKey_Down;
	if (event.key == "PageUp") return kOfxKey_Page_Up;
	if (event.key == "PageDown") return kOfxKey_Page_Down;
	if (event.key == "End") return kOfxKey_End;
	if (event.key == "Insert") return kOfxKey_Insert;
	if (event.key == "Delete") return kOfxKey_Delete;
	return event.key.size() == 1 && static_cast<unsigned char>(event.key.front()) >= 0x20
		&& static_cast<unsigned char>(event.key.front()) <= 0x7e
		? static_cast<unsigned char>(event.key.front()) : kOfxKey_Unknown;
}

const char* interact_modifier_name(const int key) {
	if (key == kOfxKey_Alt_L || key == kOfxKey_Alt_R) return "alt";
	if (key == kOfxKey_Control_L || key == kOfxKey_Control_R) return "control";
	if (key == kOfxKey_Meta_L || key == kOfxKey_Meta_R) return "meta";
	if (key == kOfxKey_Shift_L || key == kOfxKey_Shift_R) return "shift";
	return "";
}

bool single_interact_utf8_code_point(const std::string& value) {
	if (value.size() == 1) {
		const auto byte = static_cast<unsigned char>(value.front());
		return byte >= 0x20 && byte <= 0x7e;
	}
	const auto first = value.empty() ? 0U : static_cast<unsigned char>(value.front());
	const auto size = first >= 0xc2 && first <= 0xdf ? 2U
		: first >= 0xe0 && first <= 0xef ? 3U
			: first >= 0xf0 && first <= 0xf4 ? 4U : 0U;
	if (value.size() != size) return false;
	for (std::size_t index = 1; index < size; ++index) {
		if ((static_cast<unsigned char>(value[index]) & 0xc0U) != 0x80U) return false;
	}
	return (size != 3 || first != 0xe0 || static_cast<unsigned char>(value[1]) >= 0xa0)
		&& (size != 3 || first != 0xed || static_cast<unsigned char>(value[1]) < 0xa0)
		&& (size != 4 || first != 0xf0 || static_cast<unsigned char>(value[1]) >= 0x90)
		&& (size != 4 || first != 0xf4 || static_cast<unsigned char>(value[1]) < 0x90);
}

bool equal_interact_parameter_values(const ParameterValues& left, const ParameterValues& right) {
	return left.kind == right.kind && left.dimensions == right.dimensions
		&& left.current == right.current && left.keys == right.keys && left.curves == right.curves;
}
} // namespace

InteractResult HostRuntime::run_interact(
	OfxPlugin& plugin,
	const Context context,
	const InteractRequest& request
) {
	if (request.target != "overlay" && request.target != "custom-parameter") {
		throw std::invalid_argument("The OpenFX Interact target is unsupported.");
	}
	if (request.target == "overlay" && !request.parameter_name.empty()) {
		throw std::invalid_argument("An overlay Interact cannot name a parameter.");
	}
	if (request.target == "custom-parameter" && !valid_plugin_id(request.parameter_name)) {
		throw std::invalid_argument("A custom Interact requires one canonical parameter name.");
	}
	auto& state = impl_->state;
	state.reset(false);
	plugin.setHost(host());
	auto* target = &state.effect_record;
	PropertySet context_args;
	context_args.owner = &state;
	prop_set_string(handle(context_args), kOfxImageEffectPropContext, 0, official_context(context));
	const bool loaded = accepted_status(call(plugin, kOfxActionLoad, nullptr));
	const bool described = loaded && accepted_status(call(plugin, kOfxActionDescribe, target));
	const bool in_context = described && state.descriptor_valid(context)
		&& accepted_status(call(plugin, kOfxImageEffectActionDescribeInContext, target, &context_args));
	std::size_t hydrated_parameters = 0;
	std::size_t hydrated_keyframes = 0;
	const bool hydrated = in_context && hydrate_parameter_state(
		target->parameters, request.parameters, hydrated_parameters, hydrated_keyframes
	);
	const bool created = hydrated && accepted_status(call(plugin, kOfxActionCreateInstance, target));
	if (!created) {
		if (loaded) static_cast<void>(call(plugin, kOfxActionUnload, nullptr));
		throw std::runtime_error("The OpenFX plug-in failed its offscreen Interact effect lifecycle.");
	}
	const auto entry_pointer = [&]() -> void* {
		if (request.target == "overlay") {
			const auto found = target->properties.values.find(kOfxImageEffectPluginPropOverlayInteractV2);
			if (found == target->properties.values.end() || found->second.size() != 1) return nullptr;
			const auto* pointer = std::get_if<void*>(&found->second.front());
			return pointer == nullptr ? nullptr : *pointer;
		}
		const auto parameter_found = target->parameters.parameters.find(request.parameter_name);
		if (parameter_found == target->parameters.parameters.end()) return nullptr;
		const auto found = parameter_found->second->properties.values.find(kOfxParamPropInteractV1);
		if (found == parameter_found->second->properties.values.end() || found->second.size() != 1) return nullptr;
		const auto* pointer = std::get_if<void*>(&found->second.front());
		return pointer == nullptr ? nullptr : *pointer;
	}();
	if (entry_pointer == nullptr) {
		static_cast<void>(call(plugin, kOfxActionDestroyInstance, target));
		static_cast<void>(call(plugin, kOfxActionUnload, nullptr));
		throw std::runtime_error("The requested OpenFX offscreen Interact is not declared.");
	}
	auto* entry = reinterpret_cast<OfxPluginEntryPoint*>(entry_pointer);
	Interact interact_record;
	interact_record.properties.owner = &state;
	prop_set_pointer(handle(interact_record.properties), kOfxPropEffectInstance, 0, target);
	const double pixel_scale[]{1.0, 1.0};
	const double background[]{0.0, 0.0, 0.0};
	const double suggested[]{1.0, 1.0, 1.0};
	prop_set_double_n(handle(interact_record.properties), kOfxInteractPropPixelScale, 2, pixel_scale);
	prop_set_double_n(handle(interact_record.properties), kOfxInteractPropBackgroundColour, 3, background);
	prop_set_double_n(handle(interact_record.properties), kOfxInteractPropSuggestedColour, 3, suggested);
	prop_set_int(handle(interact_record.properties), kOfxInteractPropBitDepth, 0, 8);
	prop_set_int(handle(interact_record.properties), kOfxInteractPropHasAlpha, 0, 1);
	if (request.target == "custom-parameter") {
		const double size[]{64.0, 64.0};
		prop_set_double_n(
			handle(target->parameters.parameters.at(request.parameter_name)->properties),
			kOfxParamPropInteractSize, 2, size
		);
	}
	const auto invoke = [&](const char* action, PropertySet* input = nullptr) {
		try {
			return entry(
				action, &interact_record,
				input == nullptr ? nullptr : handle(*input), nullptr
			);
		} catch (...) { return kOfxStatErrFatal; }
	};
	const bool interact_described = accepted_status(invoke(kOfxActionDescribe));
	const bool interact_created = interact_described
		&& accepted_status(invoke(kOfxActionCreateInstance));
	InteractResult result;
	result.project_id = request.project_id;
	result.project_revision = request.project_revision;
	result.instance_id = request.instance_id;
	result.effect_state_sha256 = request.effect_state_sha256;
	result.target = request.target;
	result.parameter_name = request.parameter_name;
	std::vector<HydratedParameterState> baselines;
	baselines.reserve(request.parameters.size());
	for (const auto& parameter : request.parameters) {
		auto baseline = parameter;
		baseline.values = target->parameters.parameters.at(parameter.name)->values;
		baselines.push_back(std::move(baseline));
	}
	bool event_failed = !interact_created;
	std::set<int> held_modifiers;
	std::set<std::string> held_keys;
	for (const auto& event : request.events) {
		if (event_failed) break;
		PropertySet args;
		args.owner = &state;
		prop_set_pointer(handle(args), kOfxPropEffectInstance, 0, target);
		prop_set_double(handle(args), kOfxPropTime, 0, 0.0);
		prop_set_double_n(handle(args), kOfxInteractPropPixelScale, 2, pixel_scale);
		prop_set_double_n(handle(args), kOfxInteractPropBackgroundColour, 3, background);
		const double render_scale[]{1.0, 1.0};
		prop_set_double_n(handle(args), kOfxImageEffectPropRenderScale, 2, render_scale);
		const auto modifier_action = [&](const int key, const bool down) {
			prop_set_int(handle(args), kOfxPropKeySym, 0, key);
			prop_set_string(handle(args), kOfxPropKeyString, 0, "");
			const auto status = invoke(down ? kOfxInteractActionKeyDown : kOfxInteractActionKeyUp, &args);
			if (!accepted_status(status)) event_failed = true;
			if (down) held_modifiers.insert(key);
			else held_modifiers.erase(key);
		};
		int explicit_key = event.kind == "keyboard" ? official_interact_key_sym(event) : kOfxKey_Unknown;
		const std::string explicit_modifier = interact_modifier_name(explicit_key);
		if (!explicit_modifier.empty() && event.phase == "up" && !held_modifiers.contains(explicit_key)
			&& std::find(event.modifiers.begin(), event.modifiers.end(), explicit_modifier) == event.modifiers.end()) {
			// A pre-focus snapshot has no left/right identity. Pair its release
			// with the fallback key actually delivered to the plug-in.
			for (const int key : held_modifiers) {
				if (explicit_modifier == interact_modifier_name(key)) { explicit_key = key; break; }
			}
		}
		// A canvas can gain focus while modifiers are already held. OFX has no
		// pointer-modifier property: synchronize their official key actions before
		// the pointer, and retire them before LoseFocus. Synthetic actions do not
		// acquire user event sequence numbers or count as accepted input events.
		if (event.kind != "focus" || !event.focused) {
			const std::array<std::pair<const char*, int>, 4> modifiers{{
				{"alt", kOfxKey_Alt_L}, {"control", kOfxKey_Control_L},
				{"meta", kOfxKey_Meta_L}, {"shift", kOfxKey_Shift_L},
			}};
			for (const auto& [name, fallback] : modifiers) {
				const bool desired = event.kind != "focus"
					&& std::find(event.modifiers.begin(), event.modifiers.end(), name) != event.modifiers.end();
				std::vector<int> current;
				for (const int key : held_modifiers) {
					if (std::strcmp(interact_modifier_name(key), name) == 0) current.push_back(key);
				}
				if (explicit_modifier == name) {
					if (event.phase == "up" && !desired) {
						for (const int key : current) if (key != explicit_key) modifier_action(key, false);
					}
					continue;
				}
				if (desired && current.empty()) modifier_action(fallback, true);
				if (!desired) for (const int key : current) modifier_action(key, false);
			}
		}
		if (event_failed) break;
		const char* action = nullptr;
		if (event.kind == "pointer") {
			const double position[]{event.x * 63.0, (1.0 - event.y) * 63.0};
			const int viewport[]{
				static_cast<int>(std::lround(position[0])),
				static_cast<int>(std::lround(position[1])),
			};
			prop_set_double_n(handle(args), kOfxInteractPropPenPosition, 2, position);
			prop_set_int_n(handle(args), kOfxInteractPropPenViewportPosition, 2, viewport);
			prop_set_double(handle(args), kOfxInteractPropPenPressure, 0,
				event.phase == "up" ? 0.0 : event.button == 0 ? 0.0 : 1.0);
			action = event.phase == "motion" ? kOfxInteractActionPenMotion
				: event.phase == "down" ? kOfxInteractActionPenDown : kOfxInteractActionPenUp;
		} else if (event.kind == "keyboard") {
			prop_set_int(handle(args), kOfxPropKeySym, 0, explicit_key);
			prop_set_string(handle(args), kOfxPropKeyString, 0,
				single_interact_utf8_code_point(event.key) ? event.key.c_str() : "");
			const auto& physical_key = event.code.empty() ? event.key : event.code;
			if (event.phase == "down") {
				action = held_keys.insert(physical_key).second
					? kOfxInteractActionKeyDown : kOfxInteractActionKeyRepeat;
			} else {
				held_keys.erase(physical_key);
				action = kOfxInteractActionKeyUp;
			}
		} else if (event.kind == "focus") {
			if (!event.focused) held_keys.clear();
			action = event.focused ? kOfxInteractActionGainFocus : kOfxInteractActionLoseFocus;
		}
		if (action == nullptr) { event_failed = true; break; }
		const auto status = invoke(action, &args);
		if (!explicit_modifier.empty() && accepted_status(status)) {
			if (event.phase == "down") held_modifiers.insert(explicit_key);
			else {
				held_modifiers.erase(explicit_key);
				const bool desired = std::find(event.modifiers.begin(), event.modifiers.end(), explicit_modifier)
					!= event.modifiers.end();
				const bool still_held = std::any_of(held_modifiers.begin(), held_modifiers.end(), [&](const int key) {
					return explicit_modifier == interact_modifier_name(key);
				});
				if (desired && !still_held) modifier_action(explicit_key % 2 == 1 ? explicit_key + 1 : explicit_key - 1, true);
			}
		}
		if (status == kOfxStatOK) result.accepted_sequences.push_back(event.sequence);
		else if (status != kOfxStatReplyDefault) event_failed = true;
	}
	DrawContext draw;
	PropertySet draw_args;
	draw_args.owner = &state;
	prop_set_pointer(handle(draw_args), kOfxInteractPropDrawContext, 0, &draw);
	prop_set_pointer(handle(draw_args), kOfxPropEffectInstance, 0, target);
	prop_set_double(handle(draw_args), kOfxPropTime, 0, 0.0);
	prop_set_double_n(handle(draw_args), kOfxInteractPropPixelScale, 2, pixel_scale);
	prop_set_double_n(handle(draw_args), kOfxInteractPropBackgroundColour, 3, background);
	const double render_scale[]{1.0, 1.0};
	prop_set_double_n(handle(draw_args), kOfxImageEffectPropRenderScale, 2, render_scale);
	interact_record.active_draw = &draw;
	const auto draw_status = event_failed ? kOfxStatFailed : invoke(kOfxInteractActionDraw, &draw_args);
	const bool drawn = accepted_status(draw_status);
	interact_record.active_draw = nullptr;
	const bool interact_destroyed = !interact_created
		|| accepted_status(invoke(kOfxActionDestroyInstance));
	if (drawn && interact_destroyed) {
		for (auto& baseline : baselines) {
			const auto& current = target->parameters.parameters.at(baseline.name)->values;
			if (equal_interact_parameter_values(baseline.values, current)) continue;
			baseline.values = current;
			baseline.keyframe_count = current.keys.size();
			result.parameter_mutations.push_back(std::move(baseline));
		}
	}
	static_cast<void>(call(plugin, kOfxActionDestroyInstance, target));
	static_cast<void>(call(plugin, kOfxActionUnload, nullptr));
	if (!drawn || !interact_destroyed
		|| ((draw.calls == 0) != (draw.pixels_touched == 0))) {
		throw std::runtime_error("The OpenFX offscreen Interact failed its DrawSuite V1 lifecycle.");
	}
	result.redraw_requested = interact_record.redraw_requested;
	result.draw_calls = draw.calls;
	result.pixels_touched = draw.pixels_touched;
	result.surface_disposition = draw.calls == 0 ? "retained" : "drawn";
	if (result.surface_disposition == "drawn") result.rgba = draw.rgba;
	return result;
}
