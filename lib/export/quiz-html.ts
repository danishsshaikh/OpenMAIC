import type { QuizContent, QuizOption, QuizQuestion } from '@/lib/types/stage';

export interface GenerateQuizHtmlInput {
  sceneTitle: string;
  content: QuizContent;
}

export interface GenerateQuizHtmlResult {
  html: string;
  supported: boolean;
  reason?: string;
}

export function generateStandaloneQuizHtml({
  sceneTitle,
  content,
}: GenerateQuizHtmlInput): GenerateQuizHtmlResult {
  if (!Array.isArray(content.questions)) {
    return {
      html: '',
      supported: false,
      reason: 'Quiz content is missing a questions array',
    };
  }

  const quizData = {
    title: sceneTitle,
    questions: content.questions.map(normalizeQuestionForExport),
  };

  return {
    supported: true,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(sceneTitle)} - Quiz</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #0f172a; }
    main { max-width: 920px; margin: 0 auto; padding: 40px 20px 56px; }
    header { margin-bottom: 28px; }
    .eyebrow { color: #7c3aed; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 8px 0 8px; font-size: 32px; line-height: 1.18; }
    .hint { color: #64748b; margin: 0; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 16px 0; box-shadow: 0 1px 2px rgb(15 23 42 / 0.05); }
    .question-title { font-weight: 700; font-size: 18px; line-height: 1.45; margin: 0 0 14px; }
    .meta { color: #64748b; font-size: 13px; margin-bottom: 12px; }
    label.option { display: flex; align-items: flex-start; gap: 10px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 11px 12px; margin: 8px 0; cursor: pointer; }
    label.option:hover { border-color: #c4b5fd; background: #faf5ff; }
    input { margin-top: 3px; }
    textarea { width: 100%; min-height: 96px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; font: inherit; resize: vertical; }
    button { border: 0; border-radius: 10px; padding: 11px 16px; font-weight: 700; color: white; background: #7c3aed; cursor: pointer; }
    button:hover { background: #6d28d9; }
    .result { margin-top: 12px; padding: 12px; border-radius: 10px; font-size: 14px; line-height: 1.45; }
    .correct { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .incorrect { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .neutral { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
    .analysis { margin-top: 8px; color: #334155; }
    footer { color: #64748b; font-size: 13px; margin-top: 24px; }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">OpenMAIC Quiz Export</div>
      <h1 id="quiz-title"></h1>
      <p class="hint">Standalone quiz sidecar. Choice questions are graded locally when an answer key is available. Short-answer grading does not call OpenMAIC APIs.</p>
    </header>
    <section id="quiz-root"></section>
    <button id="check-answers" type="button">Check answers</button>
    <footer>This file is an exported fallback sidecar, not a full OpenMAIC classroom playback recording.</footer>
  </main>
  <script type="application/json" id="quiz-data">${escapeJsonForScript(quizData)}</script>
  <script>
(() => {
  const data = JSON.parse(document.getElementById('quiz-data').textContent || '{}');
  const root = document.getElementById('quiz-root');
  const title = document.getElementById('quiz-title');
  title.textContent = data.title || 'Quiz';

  const asArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const sameSet = (a, b) => {
    const left = [...asArray(a)].sort();
    const right = [...asArray(b)].sort();
    return left.length === right.length && left.every((value, index) => value === right[index]);
  };
  const optionLabel = (question, value) => {
    const option = (question.options || []).find((item) => item.value === value);
    return option ? option.label : value;
  };
  const cardsByQuestionId = new Map();

  function createText(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text || '';
    return el;
  }

  function renderQuestion(question, index) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.questionId = question.id;
    card.dataset.questionType = question.type;

    card.appendChild(createText('div', 'meta', 'Question ' + (index + 1) + ' · ' + question.type.replace('_', ' ')));
    card.appendChild(createText('p', 'question-title', question.question));

    if (question.type === 'single' || question.type === 'multiple') {
      (question.options || []).forEach((option) => {
        const label = document.createElement('label');
        label.className = 'option';
        const input = document.createElement('input');
        input.type = question.type === 'multiple' ? 'checkbox' : 'radio';
        input.name = question.id;
        input.value = option.value;
        label.appendChild(input);
        label.appendChild(createText('span', '', option.value + '. ' + option.label));
        card.appendChild(label);
      });
    } else {
      const textarea = document.createElement('textarea');
      textarea.name = question.id;
      textarea.placeholder = 'Enter your answer';
      card.appendChild(textarea);
    }

    const result = document.createElement('div');
    result.className = 'result neutral';
    result.hidden = true;
    card.appendChild(result);
    return card;
  }

  (data.questions || []).forEach((question, index) => {
    const card = renderQuestion(question, index);
    cardsByQuestionId.set(question.id, card);
    root.appendChild(card);
  });

  document.getElementById('check-answers').addEventListener('click', () => {
    (data.questions || []).forEach((question) => {
      const card = cardsByQuestionId.get(question.id);
      if (!card) return;
      const result = card.querySelector('.result');
      let userAnswer;
      if (question.type === 'multiple') {
        userAnswer = [...card.querySelectorAll('input:checked')].map((input) => input.value);
      } else if (question.type === 'single') {
        userAnswer = card.querySelector('input:checked')?.value || '';
      } else {
        userAnswer = card.querySelector('textarea')?.value || '';
      }

      const answerKey = asArray(question.answer);
      const hasAnswerKey = answerKey.length > 0;
      result.hidden = false;

      if (!hasAnswerKey) {
        result.className = 'result neutral';
        result.textContent = question.type === 'short_answer'
          ? 'Answer recorded. Offline grading is unavailable for this short-answer question.'
          : 'Answer recorded. This question has no answer key in the exported data.';
      } else if (question.type === 'short_answer') {
        const accepted = answerKey.map((value) => String(value).trim().toLowerCase());
        const correct = accepted.includes(String(userAnswer).trim().toLowerCase());
        result.className = 'result ' + (correct ? 'correct' : 'incorrect');
        result.textContent = correct ? 'Correct.' : 'Answer differs from the exported answer key.';
      } else {
        const correct = sameSet(userAnswer, answerKey);
        result.className = 'result ' + (correct ? 'correct' : 'incorrect');
        result.textContent = correct
          ? 'Correct.'
          : 'Incorrect. Correct answer: ' + answerKey.map((value) => optionLabel(question, value)).join(', ');
      }

      if (question.analysis) {
        const analysis = document.createElement('div');
        analysis.className = 'analysis';
        analysis.textContent = question.analysis;
        result.appendChild(analysis);
      }
    });
  });
})();
  </script>
</body>
</html>`,
  };
}

function normalizeQuestionForExport(question: QuizQuestion): QuizQuestion {
  const rawOptions = question.options as unknown[] | undefined;
  return {
    ...question,
    options: rawOptions?.map((option, index): QuizOption => {
      if (typeof option === 'string') {
        return { value: String.fromCharCode(65 + index), label: option };
      }
      const candidate = option as Partial<QuizOption>;
      return {
        value:
          typeof candidate.value === 'string' ? candidate.value : String.fromCharCode(65 + index),
        label:
          typeof candidate.label === 'string' ? candidate.label : String(candidate.value ?? ''),
      };
    }),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
