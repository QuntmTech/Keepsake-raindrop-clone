# Claude Research Brief — Sider Competitive Teardown

**Target product:** Sider AI browser extension / sidebar
**Our product:** Keepsake
**Research date:** July 2026

## Goal

Produce a rigorous product teardown of Sider that helps Keepsake decide what to build, what to ignore, and where to differentiate. Do not merely copy Sider's marketing page. Verify workflows, limitations, pricing mechanics, permissions, UX friction, and user complaints.

## Verified baseline to start from

Sider currently positions itself as an all-in-one browser AI sidebar with multiple models, page/PDF/video understanding, writing assistance, prompt reuse, translation, research tools, audio-to-text, and newer browser-agent/customization products.

Publicly visible product surfaces and claims include:

- Multi-model chat with GPT, Claude, Gemini, DeepSeek, Grok, and others.
- Group chat / answer comparison across multiple models.
- Real-time web access.
- Prompt Library and reusable custom prompts.
- Page, PDF, image, and YouTube understanding/summarization.
- Selected-text explanations and translation.
- Writing tools for article generation, email/social replies, rewriting, and grammar correction.
- Audio-to-text with timestamps, summaries, and meeting-note workflows.
- Wisebase knowledge base and deep-research products.
- Claw browser agent and Code website customization.
- Image/video creation tools.
- Chrome/Edge plus desktop and mobile apps.

Treat every claim above as a hypothesis to verify in the current product.

## User-provided feature map to verify

### Core multi-model sidebar
- One sidebar for GPT, Claude, DeepSeek, Gemini, Grok, and 20+ models.
- Group AI Chat using @mentions.
- Real-time web access.
- Edit past prompts and navigate versions.

### Prompt system
- Create, edit, archive, and reuse prompts.
- `/` command to insert saved prompts.
- Run saved prompts against selected text.
- Assign prompts to reading/writing workflows.
- Prompt Generator and reverse-prompt generation from images.

### Reading tools
- Selected-text contextual menu.
- YouTube summaries, highlights, and transcripts.
- Page reader: summary, key points, quiz.
- Screenshot chat.
- Search-engine enhancement.

### Writing tools
- Generate articles/titles.
- Rewrite in different styles and tones.
- Draft email replies and social comments.
- Input-field assistant and keyboard shortcut.
- Grammar checker.

### Files and documents
- ChatPDF, PDF translation, OCR.
- Multi-tab chat.
- Audio transcription with timestamps and speaker identification.

### Translation
- Full-page and selected-text translation.
- Image and PDF translation.
- 50+ languages and bilingual layout.

### Wisebase
- Save research, notes, and AI chats.
- Deep Research, Scholar Research, Math Solver, Rec Note, gamified learning.

### Agents and creation
- Claw browser agent.
- Code persistent website customizer.
- Web Creator and AI Slides.
- Image generation/editing/upscaling and video generation.

## Research questions Claude must answer

### 1. Actual product architecture and surfaces

Map every current user-facing surface:

- Toolbar popup
- In-page floating control
- Side panel
- Context menu
- Input-field assistant
- Full-page web app
- Desktop/mobile apps
- Wisebase
- Claw
- Code
- Create suite

For each surface, document the exact entry point, primary jobs, and whether it feels integrated or stitched together.

### 2. Core workflows

Walk through and document:

1. First-install onboarding and permissions.
2. Ask a question about the current page.
3. Summarize a YouTube video.
4. Highlight text and rewrite it.
5. Fix grammar inside a text field.
6. Create and invoke a custom prompt.
7. Upload and chat with a PDF.
8. Upload audio and transcribe it.
9. Save output into Wisebase.
10. Compare answers from multiple models.
11. Use Claw on a practical browser task.
12. Customize a site with Code.

Capture clicks, latency, confusing points, upsells, credit usage, and failure states.

### 3. Pricing and credit economics

Determine current:

- Free limits.
- Paid tiers and annual/monthly prices.
- Advanced-model credit allocation.
- Transcription/file/image/video limits.
- Whether credits expire or reset.
- What happens when users exhaust advanced credits.
- BYOK support, if any.
- Which features are hard-paywalled versus soft-gated.

Model at least three user profiles:

- Light writer/researcher.
- Heavy multi-model user.
- Heavy transcription/PDF user.

Estimate where each user hits limits and likely effective monthly cost.

### 4. Review mining

Analyze current Chrome Web Store reviews, Reddit discussions, app-store reviews, and reputable independent reviews. Categorize complaints and praise by frequency:

- Speed and reliability.
- Credit burn / pricing confusion.
- Model quality.
- Privacy and permissions.
- Sidebar usability.
- Writing quality.
- PDF/audio accuracy.
- Support and refunds.
- Feature bloat.
- Mobile/desktop sync.

Separate verified recurring patterns from isolated complaints.

### 5. Privacy and security

Inspect:

- Chrome permissions.
- Website-content access.
- Data collected according to store and privacy policy.
- Whether page content, private messages, or selected text is sent automatically or only after user action.
- Remote-code or iframe usage.
- Key storage and provider routing.
- Retention and training claims.
- Enterprise controls.

Identify any trust gap Keepsake can exploit with clearer local-first behavior.

### 6. UX strengths worth learning from

Identify Sider's best interaction patterns, especially:

- Immediate access without tab switching.
- Selected-text actions.
- Prompt library invocation.
- Model switching and comparison.
- Inline writing assistance.
- Page/PDF/video context handling.
- Credit/plan feedback.

For each pattern, explain why it works and how Keepsake could adapt it without cloning the interface.

### 7. Weaknesses and strategic openings

Look specifically for:

- Feature overload.
- Weak personal knowledge/memory.
- Poor bookmark/research organization.
- Credit anxiety.
- Privacy anxiety.
- Generic output not grounded in a user's own library.
- Fragmentation between Chat, Wisebase, Claw, Code, and Create.
- Lack of durable source capture and citation history.

### 8. Keepsake recommendation

Return a prioritized feature plan divided into:

- **Build now** — highest user value and strongest fit with Keepsake.
- **Build later** — valuable but dependent on infrastructure.
- **Partner/API** — better integrated through providers than built from scratch.
- **Do not build** — distracts from the moat or carries poor economics/risk.

Evaluate these candidate features:

- Rewrite selected text.
- Grammar/spelling correction with a visible diff.
- Tone/length/style controls.
- AI replies in email/social/support fields.
- Custom Prompt Library with slash invocation.
- Current-page chat.
- PDF and multi-tab chat.
- YouTube transcript and summary.
- Audio/video transcription.
- Deep research across the web plus the user's Keepsake vault.
- Multi-model comparison.
- Browser agents.
- Website customization.
- Image/video generation.

## Keepsake differentiation hypothesis

Sider's primary moat appears to be broad model/tool access and distribution. Keepsake should not compete by becoming a random toolbox. The likely winning position is:

> **Your private browser memory and AI workbench — every page, highlight, transcript, prompt, answer, and source becomes organized, searchable, reusable knowledge.**

Test whether the strongest strategy is:

1. Capture context from the page.
2. Transform it with AI.
3. Save both source and output into a collection.
4. Retrieve it later through search, related saves, and Ask Your Library.
5. Keep a clear local-first/BYOK privacy story.

## Required deliverables

Claude should return:

1. Executive summary.
2. Current feature matrix with verification status.
3. Detailed workflow teardown.
4. Pricing/credit model.
5. Review sentiment themes.
6. Privacy/permission comparison.
7. Sider strengths and weaknesses.
8. Keepsake build/partner/skip matrix.
9. Recommended 90-day roadmap.
10. Five defensible differentiators Keepsake can own.
11. Any claims from the user-provided feature map that were inaccurate, outdated, or unsupported.

Use direct source links and note the date each claim was verified.