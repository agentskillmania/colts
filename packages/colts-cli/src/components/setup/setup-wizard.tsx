/**
 * @fileoverview SetupWizard — first-launch configuration wizard
 *
 * 3-step guide: Choose Provider → Enter API Key → Choose Model.
 * Calls onComplete to save config after completion.
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput } from '@inkjs/ui';
import { theme } from '../../utils/theme.js';

export interface SetupConfig {
  provider: string;
  apiKey: string;
  model: string;
}

interface SetupWizardProps {
  onComplete: (config: SetupConfig) => void;
}

const PROVIDER_OPTIONS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Google', value: 'google' },
  { label: 'Other (custom base URL)', value: 'other' },
];

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.0-flash',
  other: 'gpt-4o',
};

/**
 * First-time configuration wizard component
 */
export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>colts-cli Setup</Text>
      <Box marginTop={1}>
        <Text color={theme.dim}>Step {step}/3</Text>
      </Box>

      {step === 1 && (
        <>
          <Box marginTop={1}>
            <Text>Select your LLM provider:</Text>
          </Box>
          <Select
            options={PROVIDER_OPTIONS}
            onChange={(value) => {
              setProvider(value);
              setStep(2);
            }}
          />
        </>
      )}

      {step === 2 && (
        <>
          <Box marginTop={1}>
            <Text>Enter your API key:</Text>
          </Box>
          <TextInput
            placeholder="sk-..."
            onSubmit={(value) => {
              setApiKey(value);
              setStep(3);
            }}
          />
        </>
      )}

      {step === 3 && (
        <>
          <Box marginTop={1}>
            <Text>Model (default: {DEFAULT_MODELS[provider]}):</Text>
          </Box>
          <TextInput
            placeholder={DEFAULT_MODELS[provider]}
            onSubmit={(value) => {
              onComplete({
                provider,
                apiKey,
                model: value || DEFAULT_MODELS[provider],
              });
            }}
          />
        </>
      )}
    </Box>
  );
}
