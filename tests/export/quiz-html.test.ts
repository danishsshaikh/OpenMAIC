import { describe, expect, it } from 'vitest';
import { generateStandaloneQuizHtml } from '@/lib/export/quiz-html';
import type { QuizContent } from '@/lib/types/stage';

describe('standalone quiz HTML export', () => {
  it('generates an offline quiz sidecar with embedded quiz data', () => {
    const result = generateStandaloneQuizHtml({
      sceneTitle: 'Robot Helper Quiz',
      content: quizContent(),
    });

    expect(result.supported).toBe(true);
    expect(result.html).toContain('OpenMAIC Quiz Export');
    expect(result.html).toContain('Check answers');
    expect(result.html).toContain('Short-answer grading does not call OpenMAIC APIs');

    const embedded = parseEmbeddedQuizData(result.html);
    expect(embedded.title).toBe('Robot Helper Quiz');
    expect(embedded.questions).toHaveLength(3);
    expect(embedded.questions[0]).toMatchObject({
      id: 'q1',
      type: 'single',
      question: 'What should the robot do first?',
      answer: ['A'],
    });
  });

  it('escapes title and embedded content instead of injecting raw HTML', () => {
    const result = generateStandaloneQuizHtml({
      sceneTitle: 'Bad <img src=x onerror=alert(1)>',
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'q1',
            type: 'single',
            question: 'Pick </script><img src=x onerror=alert(1)>',
            options: [{ value: 'A', label: '</script><img src=x onerror=alert(1)>' }],
            answer: ['A'],
          },
        ],
      },
    });

    expect(result.html).toContain('Bad &lt;img src=x onerror=alert(1)&gt; - Quiz');
    expect(result.html).not.toContain('</script><img src=x onerror=alert(1)>');
    expect(result.html).toContain('\\u003c/script\\u003e\\u003cimg');

    const embedded = parseEmbeddedQuizData(result.html);
    expect(embedded.questions[0].question).toBe('Pick </script><img src=x onerror=alert(1)>');
  });

  it('keeps missing answer keys as offline-ungraded quiz questions', () => {
    const result = generateStandaloneQuizHtml({
      sceneTitle: 'Ungraded Quiz',
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'q1',
            type: 'short_answer',
            question: 'Explain the result.',
          },
        ],
      },
    });

    expect(result.supported).toBe(true);
    expect(result.html).toContain('Offline grading is unavailable');
    expect(parseEmbeddedQuizData(result.html).questions[0].answer).toBeUndefined();
  });

  it('reports unsupported malformed quiz content without throwing', () => {
    const result = generateStandaloneQuizHtml({
      sceneTitle: 'Broken Quiz',
      content: { type: 'quiz' } as QuizContent,
    });

    expect(result).toEqual({
      html: '',
      supported: false,
      reason: 'Quiz content is missing a questions array',
    });
  });
});

function quizContent(): QuizContent {
  return {
    type: 'quiz',
    questions: [
      {
        id: 'q1',
        type: 'single',
        question: 'What should the robot do first?',
        options: [
          { value: 'A', label: 'Scan the area' },
          { value: 'B', label: 'Shutdown' },
        ],
        answer: ['A'],
        analysis: 'Scanning first keeps the task safe.',
      },
      {
        id: 'q2',
        type: 'multiple',
        question: 'Which sensors help?',
        options: [
          { value: 'A', label: 'Camera' },
          { value: 'B', label: 'Lidar' },
          { value: 'C', label: 'Speaker' },
        ],
        answer: ['A', 'B'],
      },
      {
        id: 'q3',
        type: 'short_answer',
        question: 'Name one safety check.',
        answer: ['obstacle check'],
      },
    ],
  };
}

function parseEmbeddedQuizData(html: string) {
  const match = html.match(/<script type="application\/json" id="quiz-data">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Quiz data script not found');
  return JSON.parse(match[1]);
}
