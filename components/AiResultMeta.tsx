import { formatEstimatedCost, knownNovitaModel } from '@/lib/modelCatalog';
import { type LlmResult } from '@/lib/llm';

export function AiResultMeta({ result, compact = false }: { result: LlmResult; compact?: boolean }) {
  const known = knownNovitaModel(result.model);
  const label = known?.label || result.model;
  const tokens = result.usage?.totalTokens;
  const cost = formatEstimatedCost(result.estimatedCostUsd);
  const items = [
    label,
    `${(result.latencyMs / 1000).toFixed(result.latencyMs < 10_000 ? 1 : 0)}s`,
    tokens ? `${tokens.toLocaleString()} tokens` : '',
    cost,
    result.fallbackCount ? `${result.fallbackCount} fallback${result.fallbackCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-faint ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className="inline-flex items-center gap-2">
          {index > 0 && <span aria-hidden="true">·</span>}
          {item}
        </span>
      ))}
      {result.routeReason && <span className="basis-full truncate" title={result.routeReason}>Auto route: {result.routeReason}</span>}
    </div>
  );
}
