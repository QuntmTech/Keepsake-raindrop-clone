import { type WriterAction } from './aiWriterPrompt';

export type WriterIntegrityKind = 'url' | 'email' | 'phone' | 'number' | 'date' | 'negation';

export interface WriterIntegrityIssue {
  kind: WriterIntegrityKind;
  value: string;
  message: string;
}

const PRESERVE_ACTIONS = new Set<WriterAction>([
  'improve', 'grammar', 'rewrite', 'shorten', 'expand', 'simplify',
  'professional', 'casual', 'humanize', 'persuasive',
]);

const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]\d{4}(?!\d)/g;
const DATE_PATTERN = /\b(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?|(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])[-/.](?:(?:19|20)?\d{2}))\b/gi;
const NUMBER_PATTERN = /(?:[$€£]\s*)?\b\d[\d,.]*(?:%|\b)/g;
const NEGATION_PATTERN = /\b(?:no|not|never|without|cannot|can['’]t|won['’]t|don['’]t|doesn['’]t|didn['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\b/gi;

function uniqueValues(text: string, pattern: RegExp): string[] {
  return [...new Set((text.match(pattern) ?? []).map((value) => value.trim()).filter(Boolean))];
}

function matchCount(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function missing(original: string[], output: string[]): string[] {
  const normalized = new Set(output.map((value) => value.toLocaleLowerCase()));
  return original.filter((value) => !normalized.has(value.toLocaleLowerCase()));
}

function maskStructuredValues(text: string): string {
  return text
    .replace(URL_PATTERN, ' ')
    .replace(EMAIL_PATTERN, ' ')
    .replace(PHONE_PATTERN, ' ')
    .replace(DATE_PATTERN, ' ');
}

export function checkWriterIntegrity(original: string, output: string, action: WriterAction): WriterIntegrityIssue[] {
  if (!PRESERVE_ACTIONS.has(action) || !original.trim() || !output.trim()) return [];

  const checks: Array<{ kind: WriterIntegrityKind; pattern: RegExp; label: string }> = [
    { kind: 'url', pattern: URL_PATTERN, label: 'link' },
    { kind: 'email', pattern: EMAIL_PATTERN, label: 'email address' },
    { kind: 'phone', pattern: PHONE_PATTERN, label: 'phone number' },
    { kind: 'date', pattern: DATE_PATTERN, label: 'date' },
  ];

  const issues: WriterIntegrityIssue[] = [];
  for (const check of checks) {
    const before = uniqueValues(original, check.pattern);
    const after = uniqueValues(output, check.pattern);
    for (const value of missing(before, after)) {
      issues.push({
        kind: check.kind,
        value,
        message: 'The rewrite removed or changed the ' + check.label + ' “' + value + '”.',
      });
    }
  }

  const beforeNumbers = uniqueValues(maskStructuredValues(original), NUMBER_PATTERN);
  const afterNumbers = uniqueValues(maskStructuredValues(output), NUMBER_PATTERN);
  for (const value of missing(beforeNumbers, afterNumbers)) {
    issues.push({
      kind: 'number',
      value,
      message: 'The rewrite removed or changed the number “' + value + '”.',
    });
  }

  const beforeNegations = matchCount(original, NEGATION_PATTERN);
  const afterNegations = matchCount(output, NEGATION_PATTERN);
  if (beforeNegations !== afterNegations) {
    issues.push({
      kind: 'negation',
      value: String(beforeNegations),
      message: 'The rewrite changed negative wording, which may reverse the meaning.',
    });
  }

  return issues.slice(0, 12);
}
