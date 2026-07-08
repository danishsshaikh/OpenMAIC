const MARKDOWN_BOLD_PATTERN = /\*\*([^*\n]+(?:\*(?!\*)[^*\n]*)*)\*\*/g;
const LATEX_ARROW_PATTERN =
  /\$?\\{1,2}(leftrightarrow|rightarrow|leftarrow|Rightarrow|to)(?![A-Za-z])\$?/g;
const SKIP_INLINE_MARKDOWN_TAGS = new Set(['code', 'pre', 'kbd', 'samp']);

function formatTextSegment(segment: string): string {
  return segment
    .replace(LATEX_ARROW_PATTERN, (_match, command: string) => {
      switch (command) {
        case 'leftarrow':
          return '←';
        case 'leftrightarrow':
          return '↔';
        case 'Rightarrow':
          return '⇒';
        case 'rightarrow':
        case 'to':
        default:
          return '→';
      }
    })
    .replace(MARKDOWN_BOLD_PATTERN, '<strong>$1</strong>');
}

export function formatInlineMarkdownBold(html: string): string {
  if (!html.includes('**') && !html.includes('\\')) return html;

  const tokens = html.split(/(<\/?[^>]+>)/g);
  const tagStack: string[] = [];

  return tokens
    .map((token) => {
      if (!token) return token;
      if (token.startsWith('<') && token.endsWith('>')) {
        const closing = /^<\s*\/\s*([a-z0-9-]+)/i.exec(token);
        if (closing) {
          const tag = closing[1].toLowerCase();
          const idx = tagStack.lastIndexOf(tag);
          if (idx >= 0) tagStack.splice(idx, 1);
          return token;
        }

        const opening = /^<\s*([a-z0-9-]+)/i.exec(token);
        if (opening && !/\/\s*>$/.test(token)) {
          const tag = opening[1].toLowerCase();
          if (SKIP_INLINE_MARKDOWN_TAGS.has(tag)) tagStack.push(tag);
        }
        return token;
      }

      return tagStack.length > 0 ? token : formatTextSegment(token);
    })
    .join('');
}
