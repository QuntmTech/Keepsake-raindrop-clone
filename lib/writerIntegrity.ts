import { type WriterAction } from './aiWriterPrompt';

export type WriterIntegrityKind = 'url' | 'email' | 'number' | 'date' | 'negation';

export interface WriterIntegrityIssue {
  kind: WriterIntegrityKind;
  value: string;
  message: string;
}

const PRESERVE_ACTIONS = new Set<WriterAction>([
  'improve', 'grammar', 'rewrite', 'shorten', 'expand', 'simplify',
  'professional', 'casual', 'humanize', 'persuasive',
]);

function values(text: string, pattern: RegExp): string[] {
  return [...new Set((text.match(pattern) ?? []).map((value) => value.trim()).filter(Boolean))];
}

function missing(original: string[], output: string[]): string[] {
  const normalized = new Set(output.map((value) => value.toLocaleLowerCase()));
  return original.filter((value) => !normalized.has(value.toLocaleLowerCase()));
}

export function checkWriterIntegrity(original: string, output: string, action: WriterAction): WriterIntegrityIssue[] {
  if (!PRESERVE_ACTIONS.has(action) || !original.trim() || !output.trim()) return [];

  const checks: Array<{ kind: WriterIntegrityKind; pattern: RegExp; label: string }> = [
    { kind: 'url', pattern: /https?:\/\/[^\s<>()]+/gi, label: 'link' },
    { kind: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, label: 'email address' },
    { kind: 'number', pattern: /(?:[$€£]\s*)?\b\d[\d,.]*(?:%|\b)/g, label: 'number' },
    { kind: 'date', pattern: /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b/gi, label: 'date' },
  ];

  const issues: WriterIntegrityIssue[] = [];
  for (const check of checks) {
    const before = values(original, check.pattern);
    const after = values(output, check.pattern);
    for (const value of missing(before, after)) {
      issues.push({
        kind: check.kind,
        value,
        message: 'The rewrite removed or changed the ' + check.label + ' “' + value + '”.',
      });
    }
  }

  const beforeNegations = values(original, /\b(?:no|not|never|without|cannot|can\'t|won\'t|don\'t|doesn\'t|didn\'t|isn\'t|aren\'t|wasn\'t|weren\'t)\b/gi);
  const afterNegations = values(output, /\b(?:no|not|never|without|cannot|can\'t|won\'t|don\'t|doesn\'t|didn\'t|isn\'t|aren\'t|wasn\'t|weren\'t)\b/gi);
  if (beforeNegations.length !== afterNegations.length) {
    issues.push({
      kind: 'negation',
      value: beforeNegations.join(', ') || 'negative wording',
      message: 'The rewrite changed negative wording, which may reverse the meaning.',
    });
  }

  return issues.slice(0, 12);
}
