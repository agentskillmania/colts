/**
 * @fileoverview 交互状态类型 — AskHuman 和 Confirm 对话框共享状态
 *
 * 当 agent 调用 ask_human 工具或需要确认的危险工具时，
 * MainTUI 切换到交互模式，渲染对应的对话框组件。
 */

import type { Question, HumanResponse } from '@agentskillmania/colts';

/**
 * 交互状态
 *
 * - `none`: 正常对话模式
 * - `ask-human`: agent 请求用户回答问题
 * - `confirm`: 危险工具需要用户确认
 */
export type InteractionState =
  | { type: 'none' }
  | {
      type: 'ask-human';
      questions: Question[];
      context?: string;
      resolve: (response: HumanResponse) => void;
    }
  | {
      type: 'confirm';
      toolName: string;
      args: Record<string, unknown>;
      resolve: (approved: boolean) => void;
    };
