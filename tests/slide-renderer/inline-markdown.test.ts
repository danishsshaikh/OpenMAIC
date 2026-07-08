import { describe, expect, it } from 'vitest';
import { formatInlineMarkdownBold as formatClassroomInlineMarkdownBold } from '@/components/slide-renderer/components/element/TextElement/inlineMarkdown';
import { formatInlineMarkdownBold as formatSnapshotInlineMarkdownBold } from '../../packages/@openmaic/renderer/src/utils/inlineMarkdown';

describe('slide inline markdown formatting', () => {
  it('renders simple inline bold without visible markdown markers', () => {
    expect(formatClassroomInlineMarkdownBold('This is **important** text')).toBe(
      'This is <strong>important</strong> text',
    );
    expect(formatSnapshotInlineMarkdownBold('This is **important** text')).toBe(
      'This is <strong>important</strong> text',
    );
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
    expect(formatClassroomInlineMarkdownBold('This is **unfinished')).toBe('This is **unfinished');
    expect(formatSnapshotInlineMarkdownBold('This is **unfinished')).toBe('This is **unfinished');
  });
});
