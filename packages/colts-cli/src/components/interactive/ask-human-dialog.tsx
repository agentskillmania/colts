/**
 * @fileoverview AskHuman 对话框 — agent 请求用户回答问题
 *
 * 支持 text、number、single-select、multi-select 四种题型。
 * 逐题展示，答完所有题后一次性返回。
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { TextInput, Select, MultiSelect } from '@inkjs/ui';
import type { Question, Answer, HumanResponse } from '@agentskillmania/colts';
import { theme } from '../../utils/theme.js';

interface AskHumanDialogProps {
  questions: Question[];
  context?: string;
  onAnswer: (response: HumanResponse) => void;
}

/**
 * AskHuman 对话框组件
 *
 * 逐题展示，收集答案后通过 onAnswer 返回 HumanResponse。
 */
export function AskHumanDialog({ questions, context, onAnswer }: AskHumanDialogProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<HumanResponse>({});

  const current = questions[currentIndex];

  function handleAnswer(value: Answer['value']) {
    const newAnswers: HumanResponse = {
      ...answers,
      [current.id]: { type: 'direct', value: value as string & number & string[] },
    };

    if (currentIndex < questions.length - 1) {
      setAnswers(newAnswers);
      setCurrentIndex(currentIndex + 1);
    } else {
      onAnswer(newAnswers);
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      {context && (
        <Box marginBottom={1}>
          <Text color={theme.dim}>{context}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text bold>
          [{currentIndex + 1}/{questions.length}] {current.question}
        </Text>
      </Box>

      {current.type === 'text' && (
        <TextInput
          placeholder="Type your answer..."
          onSubmit={(value) => handleAnswer(value)}
        />
      )}

      {current.type === 'number' && (
        <TextInput
          placeholder="Enter a number..."
          onSubmit={(value) => {
            const num = Number(value);
            handleAnswer(Number.isNaN(num) ? value : num);
          }}
        />
      )}

      {current.type === 'single-select' && current.options && (
        <Select
          options={current.options.map((o) => ({ label: o, value: o }))}
          onChange={(value) => handleAnswer(value)}
        />
      )}

      {current.type === 'multi-select' && current.options && (
        <MultiSelect
          options={current.options.map((o) => ({ label: o, value: o }))}
          onSubmit={(values) => handleAnswer(values)}
        />
      )}
    </Box>
  );
}
