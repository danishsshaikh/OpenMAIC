import { describe, expect, it } from 'vitest';
import { formatInlineMarkdownBold as formatClassroomInlineMarkdownBold } from '@/components/slide-renderer/components/element/TextElement/inlineMarkdown';
import { formatInlineMarkdownBold as formatSnapshotInlineMarkdownBold } from '../../packages/@openmaic/renderer/src/utils/inlineMarkdown';

describe('slide inline markdown formatting', () => {
  function expectBoth(input: string, output: string) {
    expect(formatClassroomInlineMarkdownBold(input)).toBe(output);
    expect(formatSnapshotInlineMarkdownBold(input)).toBe(output);
  }

  it('renders simple inline bold without visible markdown markers', () => {
    expectBoth('This is **important** text', 'This is <strong>important</strong> text');
  });

  it('does not format code/pre content', () => {
    expect(formatClassroomInlineMarkdownBold('<code>const x = **value**;</code>')).toBe(
      '<code>const x = **value**;</code>',
    );
    expect(formatSnapshotInlineMarkdownBold('<pre>const x = **value**;</pre>')).toBe(
      '<pre>const x = **value**;</pre>',
    );
  });

  it('leaves unmatched markers unchanged', () => {
    expectBoth('This is **unfinished', 'This is **unfinished');
  });

  it('normalizes common generated LaTeX arrow commands in prose', () => {
    expectBoth('Source $\\rightarrow$ All', 'Source → All');
    expectBoth('Reduce $\\\\rightarrow$ All', 'Reduce → All');
    expectBoth('A \\rightarrow B', 'A → B');
    expectBoth('A $\\leftarrow$ B', 'A ← B');
    expectBoth('A $\\leftrightarrow$ B', 'A ↔ B');
    expectBoth('A $\\Rightarrow$ B', 'A ⇒ B');
    expectBoth('A $\\to$ B', 'A → B');
  });

  it('combines arrow normalization with inline bold', () => {
    expectBoth(
      'This is **important** and A $\\rightarrow$ B',
      'This is <strong>important</strong> and A → B',
    );
  });

  it('keeps code-like expressions unchanged', () => {
    expectBoth('Arrays use arr[i]', 'Arrays use arr[i]');
    expectBoth('a * b', 'a * b');
    expect(formatClassroomInlineMarkdownBold('<code>A \\rightarrow B</code>')).toBe(
      '<code>A \\rightarrow B</code>',
    );
    expect(formatSnapshotInlineMarkdownBold('<pre>A \\rightarrow B</pre>')).toBe(
      '<pre>A \\rightarrow B</pre>',
    );
  });

  it('normalizes generated inline unicode bullets into visible list items', () => {
    expectBoth(
      '• Send message • Wait for reply • Continue work',
      '<ul><li>Send message</li><li>Wait for reply</li><li>Continue work</li></ul>',
    );
    expectBoth(
      'Blocking • Send message • Wait for receiver',
      'Blocking<br><ul><li>Send message</li><li>Wait for receiver</li></ul>',
    );
  });

  it('normalizes markdown and newline-separated generated list items', () => {
    expectBoth(
      '- Send message\n- Wait for reply',
      '<ul><li>Send message</li><li>Wait for reply</li></ul>',
    );
    expectBoth(
      '* Send message\n* Wait for reply',
      '<ul><li>Send message</li><li>Wait for reply</li></ul>',
    );
    expectBoth('1. Send\n2. Wait', '<ol><li>Send</li><li>Wait</li></ol>');
    expectBoth('3. Send\n4. Wait', '<ol start="3"><li>Send</li><li>Wait</li></ol>');
  });

  it('preserves hard line breaks without forcing prose into a list', () => {
    expectBoth('First point\nSecond point', 'First point<br>Second point');
    expectBoth('First point<br>Second point', 'First point<br>Second point');
  });

  it('leaves existing list markup and code blocks intact', () => {
    expectBoth('<ul><li>Send</li><li>Wait</li></ul>', '<ul><li>Send</li><li>Wait</li></ul>');
    expect(formatClassroomInlineMarkdownBold('<code>• Send • Wait</code>')).toBe(
      '<code>• Send • Wait</code>',
    );
    expect(formatSnapshotInlineMarkdownBold('<pre>- Send\n- Wait</pre>')).toBe(
      '<pre>- Send\n- Wait</pre>',
    );
  });
});
