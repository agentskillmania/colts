/**
 * @fileoverview SplitPane component unit tests
 */

import React from 'react';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SplitPane } from '../../../src/components/layout/split-pane.js';

describe('SplitPane', () => {
  it('should render left and right content', () => {
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

  it('should display left title', () => {
    const { lastFrame } = render(
      <SplitPane
        leftTitle="Chat"
        left={<Text>hello</Text>}
        right={<Text>world</Text>}
      />
    );
    expect(lastFrame()).toContain('Chat');
  });

  it('should display right title', () => {
    const { lastFrame } = render(
      <SplitPane
        rightTitle="Events"
        left={<Text>hello</Text>}
        right={<Text>world</Text>}
      />
    );
    expect(lastFrame()).toContain('Events');
  });

  it('should hide right content when rightVisible=false', () => {
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

  it('should hide right title when collapsed', () => {
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

  it('should not show title bar when no titles are provided', () => {
    const { lastFrame } = render(
      <SplitPane left={<Text>L</Text>} right={<Text>R</Text>} />
    );
    const frame = lastFrame();
    expect(frame).toContain('L');
    expect(frame).toContain('R');
  });

  it('should show right content by default', () => {
    const { lastFrame } = render(
      <SplitPane left={<Text>L</Text>} right={<Text>R</Text>} />
    );
    expect(lastFrame()).toContain('R');
  });
});
