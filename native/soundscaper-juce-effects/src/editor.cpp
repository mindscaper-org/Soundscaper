/* SPDX-License-Identifier: AGPL-3.0-only */
#include "editor.h"

namespace soundscaper::effects {
Editor::Editor(Processor &value)
	: juce::DocumentWindow(effectSpec(value.kind).name,
		juce::Colours::darkgrey, juce::DocumentWindow::closeButton), processor(value)
{
	setUsingNativeTitleBar(true);
	const auto &spec = effectSpec(processor.kind);
	panel.setSize(600, static_cast<int>(spec.parameterCount) * 50 + 40 + (processor.kind == Kind::convolution ? 110 : 0));
	for (uint32_t index = 0; index < processor.parameterCount(); ++index) {
		const auto &parameter = spec.parameters[index];
		auto &slider = sliders[index];
		if (parameter.choiceCount > 1) {
			auto &choice = choices[index];
			for (uint32_t item = 0; item < parameter.choiceCount; ++item) choice.addItem(parameter.choices[item], static_cast<int>(item) + 1);
			choice.setSelectedItemIndex(static_cast<int>(std::round(parameter.physical(static_cast<float>(processor.parameter(index))))));
			choice.setBounds(180, 20 + static_cast<int>(index) * 50, 400, 30);
			choice.onChange = [this, index]() {
				processor.setParameter(index, static_cast<double>(choices[index].getSelectedItemIndex())
					/ (effectSpec(processor.kind).parameters[index].choiceCount - 1));
			};
			panel.addAndMakeVisible(choice);
		} else {
			slider.setRange(parameter.minimum, parameter.maximum, 0);
			if (parameter.logarithmic) slider.setSkewFactorFromMidPoint(std::sqrt(parameter.minimum * parameter.maximum));
			slider.setValue(parameter.physical(static_cast<float>(processor.parameter(index))));
			slider.setTextValueSuffix(*parameter.unit == '\0' ? "" : juce::String(" ") + parameter.unit);
			slider.setBounds(170, 15 + static_cast<int>(index) * 50, 410, 40);
			slider.onValueChange = [this, index]() {
				processor.setParameter(index, effectSpec(processor.kind).parameters[index].normalized(static_cast<float>(sliders[index].getValue())));
			};
			panel.addAndMakeVisible(slider);
		}
		labels[index].setText(parameter.name, juce::dontSendNotification);
		labels[index].setBounds(15, 15 + static_cast<int>(index) * 50, 135, 40);
		panel.addAndMakeVisible(labels[index]);
	}
	if (processor.kind == Kind::convolution) {
		const int top = static_cast<int>(spec.parameterCount) * 50 + 20;
		load.setBounds(15, top, 250, 35); panel.addAndMakeVisible(load);
		status.setBounds(15, top + 40, 570, 55); panel.addAndMakeVisible(status);
		status.setText(processor.impulseName().isEmpty() ? "Load a mono or stereo WAV/AIFF impulse response."
			: processor.impulseName(), juce::dontSendNotification);
		load.onClick = [this]() {
			chooser = std::make_unique<juce::FileChooser>("Load impulse response", juce::File(), "*.wav;*.aif;*.aiff");
			chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
				[safe = juce::Component::SafePointer<Editor>(this)](const juce::FileChooser &selected) {
					if (safe == nullptr || selected.getResult() == juce::File()) return;
					juce::String error;
					const bool loaded = safe->processor.loadImpulseFile(selected.getResult(), error);
					safe->status.setText(loaded ? safe->processor.impulseName() : error, juce::dontSendNotification);
				});
		};
	}
	setContentNonOwned(&panel, true); centreWithSize(getWidth(), getHeight());
	startTimerHz(10);
}
void Editor::timerCallback()
{
	processor.collectRetired();
	for (uint32_t index = 0; index < processor.parameterCount(); ++index) {
		if (sliders[index].isMouseButtonDown()) continue;
		const auto &parameter = effectSpec(processor.kind).parameters[index];
		const auto value = parameter.physical(static_cast<float>(processor.parameter(index)));
		if (parameter.choiceCount > 1) choices[index].setSelectedItemIndex(static_cast<int>(std::round(value)), juce::dontSendNotification);
		else sliders[index].setValue(value, juce::dontSendNotification);
	}
}
}
