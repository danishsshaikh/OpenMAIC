'use client';

import type { PPTShapeElement, ShapeText } from '@openmaic/dsl';
import { useElementOutline } from '../hooks/useElementOutline';
import { useElementShadow } from '../hooks/useElementShadow';
import { useElementFlip } from '../hooks/useElementFlip';
import { useElementFill } from '../hooks/useElementFill';
import { GradientDefs } from './GradientDefs';
import { PatternDefs } from './PatternDefs';
import { formatInlineMarkdownBold } from '../TextElement/inlineMarkdown';
import { getTextFitStyle, useTextAutoFit } from '../TextElement/textAutoFit';

export interface BaseShapeElementProps {
  elementInfo: PPTShapeElement;
}

/**
 * Base shape element for read-only/playback mode
 */
export function BaseShapeElement({ elementInfo }: BaseShapeElementProps) {
  const { fill } = useElementFill(elementInfo, 'base');
  const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(elementInfo.outline);
  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const { flipStyle } = useElementFlip(elementInfo.flipH, elementInfo.flipV);

  const text: ShapeText = elementInfo.text || {
    content: '',
    align: 'middle',
    defaultFontName: 'Microsoft YaHei',
    defaultColor: '#333333',
  };
  const textContent = formatInlineMarkdownBold(
    typeof text.content === 'string' ? text.content : '',
  );
  const { containerRef, textRef, textFitScale } = useTextAutoFit(
    `${textContent}:${elementInfo.width}:${elementInfo.height}:${text.lineHeight ?? ''}:${text.defaultFontName ?? ''}`,
  );

  return (
    <div
      className="base-element-shape absolute"
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
      }}
    >
      <div
        className="rotate-wrapper w-full h-full"
        style={{ transform: `rotate(${elementInfo.rotate}deg)` }}
      >
        <div
          className="element-content relative w-full h-full"
          style={{
            opacity: elementInfo.opacity,
            filter: shadowStyle ? `drop-shadow(${shadowStyle})` : '',
            transform: flipStyle,
            color: text.defaultColor,
            fontFamily: text.defaultFontName,
          }}
        >
          <svg
            overflow="visible"
            width={elementInfo.width}
            height={elementInfo.height}
            className="transform-origin-[0_0] overflow-visible block"
          >
            <defs>
              {elementInfo.pattern && (
                <PatternDefs id={`base-pattern-${elementInfo.id}`} src={elementInfo.pattern} />
              )}
              {elementInfo.gradient && (
                <GradientDefs
                  id={`base-gradient-${elementInfo.id}`}
                  type={elementInfo.gradient.type}
                  colors={elementInfo.gradient.colors}
                  rotate={elementInfo.gradient.rotate}
                />
              )}
            </defs>
            <g
              transform={`scale(${elementInfo.width / elementInfo.viewBox[0]}, ${
                elementInfo.height / elementInfo.viewBox[1]
              }) translate(0,0) matrix(1,0,0,1,0,0)`}
            >
              <path
                vectorEffect="non-scaling-stroke"
                strokeLinecap="butt"
                strokeMiterlimit="8"
                d={elementInfo.path}
                fill={fill}
                stroke={outlineColor}
                strokeWidth={outlineWidth}
                strokeDasharray={strokeDashArray}
              />
            </g>
          </svg>

          <div
            ref={containerRef}
            className={`shape-text flex flex-col px-2.5 py-2.5 leading-relaxed break-words absolute inset-0 ${
              textFitScale < 0.995
                ? 'justify-start'
                : text.align === 'top'
                  ? 'justify-start'
                  : text.align === 'bottom'
                    ? 'justify-end'
                    : 'justify-center'
            }`}
            style={{
              lineHeight: text.lineHeight,
              letterSpacing: `${text.wordSpace || 0}px`,
              boxSizing: 'border-box',
              overflow: 'hidden',
            }}
          >
            <div
              ref={textRef}
              className="ProseMirror-static [&_p]:mb-[var(--paragraphSpace)]"
              style={{
                // @ts-expect-error CSS custom properties
                '--paragraphSpace': `${text.paragraphSpace === undefined ? 5 : text.paragraphSpace}px`,
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                ...getTextFitStyle(textFitScale),
              }}
              dangerouslySetInnerHTML={{ __html: textContent }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
