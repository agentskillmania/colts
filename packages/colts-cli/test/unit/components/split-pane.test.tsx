/**
 * @fileoverview SplitPane 组件单元测试
 */

import React from 'react';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SplitPane } from '../../../src/components/layout/split-pane.js';

describe('SplitPane', () => {
  it('渲染左右两侧内容', () => {
    const { lastFrame } = render(
      <SplitPane
        left={<Text>Left Content</Text>}
        right={<Text>Right Content</Text>}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain('Left Content');
    expect(frame).toContain('Right Content');
  });

  it('显示左侧标题', () => {
    const { lastFrame } = render(
      <SplitPane
        leftTitle="Chat"
        left={<Text>hello</Text>}
        right={<Text>world</Text>}
      />
    );
    expect(lastFrame()).toContain('Chat');
  });

  it('显示右侧标题', () => {
    const { lastFrame } = render(
      <SplitPane
        rightTitle="Events"
        left={<Text>hello</Text>}
        right={<Text>world</Text>}
      />
    );
    expect(lastFrame()).toContain('Events');
  });

  it('rightVisible=false 时隐藏右侧内容', () => {
    const { lastFrame } = render(
      <SplitPane
        left={<Text>Left Content</Text>}
        right={<Text>Right Content</Text>}
        rightVisible={false}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain('Left Content');
    expect(frame).not.toContain('Right Content');
  });

  it('折叠时隐藏右侧标题', () => {
    const { lastFrame } = render(
      <SplitPane
        leftTitle="Chat"
        rightTitle="Events"
        left={<Text>hello</Text>}
        right={<Text>world</Text>}
        rightVisible={false}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain('Chat');
    expect(frame).not.toContain('Events');
  });

  it('不传标题时不显示标题栏', () => {
    const { lastFrame } = render(
      <SplitPane left={<Text>L</Text>} right={<Text>R</Text>} />
    );
    const frame = lastFrame();
    expect(frame).toContain('L');
    expect(frame).toContain('R');
  });

  it('默认右侧可见', () => {
    const { lastFrame } = render(
      <SplitPane left={<Text>L</Text>} right={<Text>R</Text>} />
    );
    expect(lastFrame()).toContain('R');
  });
});
