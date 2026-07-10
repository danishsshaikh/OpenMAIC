const MARKDOWN_BOLD_PATTERN = /\*\*([^*\n]+(?:\*(?!\*)[^*\n]*)*)\*\*/g;
const LATEX_ARROW_PATTERN =
  /\$?\\{1,2}(leftrightarrow|rightarrow|leftarrow|Rightarrow|to)(?![A-Za-z])\$?/g;
const SKIP_INLINE_MARKDOWN_TAGS = new Set(['code', 'pre', 'kbd', 'samp']);

function formatInlineMarks(segment: string): string {
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

function formatTextSegment(segment: string): string {
  return formatGeneratedListSegment(segment) ?? formatInlineMarks(segment).replace(/\n/g, '<br>');
}

function formatGeneratedListSegment(segment: string): string | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    const ordered = lines.map(parseOrderedListLine);
    if (ordered.every(Boolean)) {
      const start = ordered[0]?.number ?? 1;
      return `<ol${start === 1 ? '' : ` start="${start}"`}>${ordered
        .map((item) => `<li>${formatInlineMarks(item!.text)}</li>`)
        .join('')}</ol>`;
    }

    const unordered = lines.map(parseUnorderedListLine);
    if (unordered.every(Boolean)) {
      return `<ul>${unordered.map((item) => `<li>${formatInlineMarks(item!)}</li>`).join('')}</ul>`;
    }

    return lines.map(formatInlineMarks).join('<br>');
  }

  const bulletList = parseInlineBulletList(trimmed);
  if (bulletList) {
    const prefix = bulletList.prefix ? `${formatInlineMarks(bulletList.prefix)}<br>` : '';
    return `${prefix}<ul>${bulletList.items
      .map((item) => `<li>${formatInlineMarks(item)}</li>`)
      .join('')}</ul>`;
  }

  return null;
}

function parseInlineBulletList(text: string): { prefix: string; items: string[] } | null {
  const bulletCount = (text.match(/•/g) ?? []).length;
  if (bulletCount === 0) return null;
  if (!text.trimStart().startsWith('•') && bulletCount < 2) return null;

  const firstBullet = text.indexOf('•');
  const prefix = text.slice(0, firstBullet).trim();
  const items = text
    .slice(firstBullet)
    .split(/\s*•\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? { prefix, items } : null;
}

function parseUnorderedListLine(line: string): string | null {
  return /^(?:[-*]\s+|•\s*)(.+)$/.exec(line)?.[1]?.trim() ?? null;
}

function parseOrderedListLine(line: string): { number: number; text: string } | null {
  const match = /^(\d+)[.)]\s+(.+)$/.exec(line);
  if (!match) return null;
  return { number: Number(match[1]), text: match[2].trim() };
}

export function formatInlineMarkdownBold(html: string): string {
  if (!/[\\*\n•]|<br\s*\/?>|(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/i.test(html)) return html;

  const tokens = html.split(/(<\/?[^>]+>)/g);
  const tagStack: string[] = [];
  let textBuffer = '';
  const output: string[] = [];

  const flushText = () => {
    if (!textBuffer) return;
    output.push(formatTextSegment(textBuffer));
    textBuffer = '';
  };

  for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith('<') && token.endsWith('>')) {
      if (/^<\s*br\s*\/?\s*>$/i.test(token) && tagStack.length === 0) {
        textBuffer += '\n';
        continue;
      }

      flushText();
      const closing = /^<\s*\/\s*([a-z0-9-]+)/i.exec(token);
      if (closing) {
        const tag = closing[1].toLowerCase();
        const idx = tagStack.lastIndexOf(tag);
        if (idx >= 0) tagStack.splice(idx, 1);
        output.push(token);
        continue;
      }

      const opening = /^<\s*([a-z0-9-]+)/i.exec(token);
      if (opening && !/\/\s*>$/.test(token)) {
        const tag = opening[1].toLowerCase();
        if (SKIP_INLINE_MARKDOWN_TAGS.has(tag)) tagStack.push(tag);
      }
      output.push(token);
      continue;
    }

    if (tagStack.length > 0) {
      flushText();
      output.push(token);
    } else {
      textBuffer += token;
    }
  }

  flushText();
  return output.join('');
}
