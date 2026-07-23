# Keepsake 8.16 — AI Selection Command Center + Plan Contract

This document defines the extension-side behavior and the server contract. PocketBase remains the authoritative security, billing, and usage-enforcement boundary.

## Selection Command Center

- Built-in actions: Improve, Summarize, Explain, Key points, Reply, Translate, Grammar, Shorten, and Professional.
- Users can enable, hide, and reorder built-in actions.
- Users can create named custom actions with their own instructions.
- The in-page menu can be closed for the current selection, hidden for the current visit, disabled for the current website, or disabled globally.
- Reading selections and editable-field selections can be controlled separately.
- Translation language is configurable.

## Hosted-AI plan policy

BYOK requests are not capped because the user pays the provider directly. These limits apply only to Keepsake-hosted AI.

| Plan | Hosted AI allowance | Custom selection actions | Model access |
| --- | ---: | ---: | --- |
| Free | 15 weighted credits/day | 2 | Economy/basic |
| Pro | 2,500 weighted credits/month | 10 | Economy, balanced, limited best |
| Max | 10,000 weighted credits/month | 30 | All routes including best |
| Owner | Unlimited | Unlimited | All routes |

Suggested action weights:

- 1 credit: grammar, improve, shorten, translate.
- 2 credits: explain, summarize, key points, reply, professional, and custom prompts.
- A server-side model multiplier may apply when the user chooses a more expensive route.

## Backend requirements

See GitHub issue #20. The backend must atomically enforce usage, trust server-side identity and plan state only, expose authoritative remaining usage, support Pro and Max checkout, and never deduct BYOK calls.
