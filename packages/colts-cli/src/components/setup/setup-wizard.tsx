/**
 * @fileoverview SetupWizard — 首次启动配置向导
 *
 * 3 步引导：选择 Provider → 输入 API Key → 选择 Model。
 * 完成后调用 onComplete 保存配置。
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
 * 首次配置向导组件
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
