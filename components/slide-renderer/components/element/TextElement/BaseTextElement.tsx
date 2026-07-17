'use client';

import type { PPTTextElement } from '@openmaic/dsl';
import { useElementShadow } from '../hooks/useElementShadow';
import { ElementOutline } from '../ElementOutline';
import { formatInlineMarkdownBold } from './inlineMarkdown';
import { getTextFitStyle, useTextAutoFit } from './textAutoFit';

export interface BaseTextElementProps {
  elementInfo: PPTTextElement;
  target?: string;
}

/**
 * Base text element component (read-only)
 * Renders static text content with styling
 */
export function BaseTextElement({ elementInfo, target }: BaseTextElementProps) {
  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const content = formatInlineMarkdownBold(
    typeof elementInfo.content === 'string' ? elementInfo.content : '',
  );
  const { containerRef, textRef, textFitScale } = useTextAutoFit(
    `${content}:${elementInfo.width}:${elementInfo.height}:${elementInfo.lineHeight ?? ''}:${elementInfo.defaultFontName ?? ''}`,
  );
  const vAlign = elementInfo.vAlign ?? 'top';
  const justifyContent =
    vAlign === 'middle' ? 'center' : vAlign === 'bottom' ? 'flex-end' : 'flex-start';

  return (
    <div
      className="base-element-text absolute"
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
        overflow: 'hidden',
      }}
    >
      <div
        className="rotate-wrapper w-full h-full"
        style={{
          transform: `rotate(${elementInfo.rotate}deg)`,
          backgroundColor: elementInfo.fill,
          opacity: elementInfo.opacity,
          display: 'flex',
          flexDirection: 'column',
          justifyContent,
        }}
      >
        <div
          ref={containerRef}
          className="element-content relative p-[10px] leading-[1.5] break-words"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: textFitScale < 0.995 ? 'flex-start' : justifyContent,
            width: elementInfo.vertical ? 'auto' : '100%',
            height: '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            textShadow: shadowStyle,
            lineHeight: elementInfo.lineHeight,
            letterSpacing: `${elementInfo.wordSpace || 0}px`,
            color: elementInfo.defaultColor,
            fontFamily: elementInfo.defaultFontName,
            writingMode: elementInfo.vertical ? 'vertical-rl' : 'horizontal-tb',
            // @ts-expect-error - CSS custom property
            '--paragraphSpace': `${elementInfo.paragraphSpace === undefined ? 5 : elementInfo.paragraphSpace}px`,
          }}
        >
          <ElementOutline
            width={elementInfo.width}
            height={elementInfo.height}
            outline={elementInfo.outline}
          />
          <div
            ref={textRef}
            className={`text ProseMirror-static relative ${target === 'thumbnail' ? 'pointer-events-none' : ''}`}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              overflow: 'hidden',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
              ...getTextFitStyle(textFitScale),
            }}
            dangerouslySetInnerHTML={{ __html: content }}
          />
        </div>
      </div>
    </div>
  );
}
