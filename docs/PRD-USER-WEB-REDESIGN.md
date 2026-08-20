# PRD - AnalisaCPNS User Web Redesign

Status: Draft for approval
Product: AnalisaCPNS by Mimin CPNS
Scope: Public user web only
Reference: Rankline A brand identity and the existing SKD rationalization engine

## 1. Product Direction

AnalisaCPNS is a data utility that turns an SKD score into an understandable competitive position. The product is not a government portal, announcement site, or generic CPNS news site.

The redesigned web should help a user complete one main job:

> Find the correct SKD record, understand the score context, choose a rationalization target, and receive the full analysis through WhatsApp.

The first screen is the usable search experience, not a long marketing landing page. Supporting explanation appears after the primary tool or on dedicated pages.

## 2. Product Principles

1. Position before prediction: explain where a score sits in historical competition before giving a recommendation.
2. Data before decoration: every visual element should help users search, compare, or understand confidence.
3. Progressive disclosure: show simple conclusions first, then let users open supporting details.
4. Honest historical context: clearly separate SKD 2024 data, simulations, and future official CPNS data.
5. WhatsApp completes the analysis: the website prepares the request and code; the full rationalization result remains delivered through WhatsApp.
6. No forced login: the main flow remains usable without an account.

## 3. Target Users

### Primary

- CPNS candidates who already have an SKD record.
- Candidates deciding whether to reuse a score or retake the test.
- Users comparing their score against another institution or formation.

### Secondary

- First-time candidates researching historical competition.
- Social media users arriving from TikTok, Threads, Instagram, or WhatsApp.
- Users who only know their score but cannot find their name in the dataset.

## 4. Core User Jobs

- Find my official historical SKD record quickly.
- Confirm that the selected participant record is mine.
- Understand whether I passed the basic threshold and how competitive the score was.
- Test the same score against another formation or institution.
- Receive a short list of rational alternatives, not hundreds of formations.
- Know how much score improvement is recommended.
- Receive a clear, shareable analysis card through WhatsApp.

## 5. Information Architecture

### Primary navigation

- Cek posisi
- Jelajahi formasi
- Metodologi
- CTA: Mulai analisis

### Routes

| Route                   | Purpose                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `/`                     | Search-first product home and current data coverage                      |
| `/search`               | Backward-compatible search route; can redirect to the home search state  |
| `/result/:scoreId`      | Verify participant, inspect score context, and configure rationalization |
| `/wa/:token`            | WhatsApp handoff, processing expectation, and code copy                  |
| `/formasi`              | Public institution and formation explorer                                |
| `/formasi/:formationId` | Formation history, competition, cutoff, and score simulation             |
| `/metodologi`           | Data source, calculation explanation, limitations, and update coverage   |

Full analysis is not shown on a public result URL in the first release. WhatsApp remains the delivery channel.

## 6. Primary User Flow

### Flow A - Find my SKD record

1. User opens the home page.
2. The default tool asks for participant name or participant number.
3. Optional filters for institution and formation stay collapsed until needed.
4. Search returns compact candidate matches.
5. User selects `Ini data saya`.
6. The participant detail page shows identity, TWK, TIU, TKP, total, source page, and basic score context.
7. User chooses recommendation scope:
   - Jabatan sejenis.
   - Semua yang sesuai pendidikan.
8. User may choose a specific target institution or formation.
9. User enters a nickname, target year, and current plan.
10. Website creates an RSKD code.
11. User opens WhatsApp with the message already prepared.
12. WhatsApp confirms the request, processes the rationalization, and sends one result image.

### Flow B - Test my score in another formation

1. User starts from a participant result or the formation explorer.
2. User selects `Bandingkan dengan nilai saya`.
3. The system reuses the selected participant score.
4. User chooses up to three target formations.
5. The website shows a preview comparison:
   - Historical quota.
   - Attended participants.
   - Competition ratio.
   - Historical shortlist cutoff.
   - Score gap.
6. User chooses one priority target or asks for automatic recommendations.
7. The full recommendation is generated only after the RSKD code is sent to WhatsApp.

### Flow C - My data is not found

1. Empty results explain how to broaden the spelling or remove filters.
2. User can choose `Analisis dengan input nilai`.
3. User enters TWK, TIU, TKP, total, and education.
4. The interface clearly labels the outcome as self-reported simulation, not an official participant record.
5. This flow belongs to Phase 2 because the current system is centered on verified participant records.

## 7. Screen Requirements

### 7.1 Product Home - Cek Posisi

The first viewport must contain:

- AnalisaCPNS full logo with a small `by Mimin CPNS` endorsement.
- A direct search field with one clear primary action: `Cari data SKD`.
- A segmented mode control:
  - Cari data saya.
  - Jelajahi formasi.
- Current coverage summary: published institutions, formations, and participants.
- A short trust line: historical public announcement data, no login required.

Do not place the primary experience inside a decorative hero card. Use a full-width utility band with a constrained content column.

Below the tool:

- Three-step explanation: Cari data -> Pilih target -> Terima analisis di WhatsApp.
- A real sample of the rationalization card.
- Data coverage and update status.
- Compact methodology and disclaimer links.

### 7.2 Search Results

Each result row contains:

- Participant name.
- Masked participant number.
- Institution and formation.
- TWK, TIU, TKP, and total.
- Historical data label.
- Source-page indicator.
- Primary action: `Ini data saya`.

Requirements:

- Results should be rows on desktop and compact stacked records on mobile.
- Do not use large repeated marketing cards.
- Highlight exact participant-number matches above name-only matches.
- Keep filters visible after search so users can refine without returning.

### 7.3 Participant Position Preview

This page confirms the selected identity before generating any code.

Primary content:

- Participant identity and original institution/formation.
- Score strip for TWK, TIU, TKP, and total.
- Passing-grade status.
- Historical position summary when formation statistics are available.
- Data confidence and source reference.

Secondary content:

- Score-strength breakdown.
- Lowest subtest and improvement priority.
- Original formation competition summary.
- Button to inspect the source PDF page when available.

The page must avoid declaring `aman` solely from passing grade. Copy should distinguish passing threshold from competitive position.

### 7.4 Rationalization Setup

Use one guided panel with three short sections, not a long generic form:

1. Tujuan
   - Target year.
   - Reuse score, retake test, or undecided.
2. Cakupan rekomendasi
   - Similar positions.
   - All positions compatible with education.
3. Target priority
   - Automatic recommendations.
   - Search and select a specific formation.

The user can see a compact preview of the selected target before creating the code.

Primary action: `Buat kode analisis`.

### 7.5 WhatsApp Handoff

The page shows:

- RSKD code.
- Copy action.
- Primary WhatsApp action.
- Expected processing time.
- Explanation that one analysis image will be delivered.
- Link to start a new search.

Do not show fake progress. Once a real job-status endpoint is available, the page may show `Diterima`, `Sedang dianalisis`, and `Terkirim` states.

### 7.6 Formation Explorer

This is the main additional public feature recommended for the redesign.

Filters:

- Institution.
- Position or formation.
- Education.
- Formation type.
- Competition level.

Columns or fields:

- Position.
- Institution and location.
- Education.
- Quota.
- Attended participants.
- Competition ratio.
- Historical cutoff.
- Data confidence.

Actions:

- View details.
- Compare.
- Use my score.

The explorer should use server pagination and never download the entire dataset to the browser.

### 7.7 Formation Detail

- Formation identity and education requirements.
- Historical quota and attendance.
- Competition ratio.
- Minimum, median, maximum, and shortlist cutoff score.
- Score-distribution visualization.
- Source and data-quality status.
- `Bandingkan dengan nilai saya` action.

### 7.8 Methodology and Data Coverage

- What data is included.
- Difference between SKD, SKB, TH, and TL.
- How cutoff, simulated rank, percentile, and recommendation confidence are calculated.
- Institution coverage table.
- Last published date.
- Known limitations.
- Clear distinction between historical and official future data.

## 8. Visual System

### Brand direction

- Brand: AnalisaCPNS by Mimin CPNS.
- Mark: Rankline A.
- Personality: credible, modern, data-driven, friendly, and non-institutional.
- Signature: a thin rankline rail that moves from score to position and ends in one cyan data point. Use it for progress, comparison, and section transitions rather than as decoration.

### Color tokens

| Token        | Value     | Use                                               |
| ------------ | --------- | ------------------------------------------------- |
| Ink Navy     | `#071B36` | headings, primary text, brand surfaces            |
| Royal Signal | `#2F6BFF` | primary action, active tabs, links                |
| Signal Cyan  | `#39D4D8` | active data point and restrained status highlight |
| Mist         | `#F4F8FF` | quiet data bands and selected rows                |
| White        | `#FFFFFF` | main canvas                                       |
| Line         | `#D9E4F1` | borders and table separators                      |
| Success      | `#16805C` | verified and competitive states                   |
| Warning      | `#B56A00` | close-call and limited-confidence states          |
| Risk         | `#B43B45` | below-threshold and failed states                 |

Avoid making the interface entirely blue. Status colors must carry meaning.

### Typography

- Display and body: Plus Jakarta Sans.
- Numeric and technical labels: IBM Plex Mono.
- No viewport-based font scaling.
- Large display type is reserved for the product home only; dashboards, forms, and results use compact headings.

### Layout

- Maximum content width: 1180-1240 px.
- Main workflow width: 760-960 px depending on the screen.
- Cards: maximum 8 px radius.
- Use full-width page bands and table surfaces; avoid cards inside cards.
- Data tables use visible separators and sticky headers when useful.
- Mobile navigation uses a compact header and bottom action area when the main CTA must remain reachable.

### Motion

- One entry sequence for the rankline and active data point.
- Short state transitions for search results and selected targets.
- No continuous decorative animation.
- Respect reduced-motion preferences.

## 9. Content and Terminology

Use plain Indonesian and consistent product vocabulary.

Preferred terms:

- Cek posisi nilai.
- Persaingan historis.
- Batas historis.
- Posisi simulasi.
- Rekomendasi target.
- Data terbatas.
- Belum cukup data.

Avoid:

- Guaranteed pass language.
- `Aman` without supporting context.
- Technical database terms.
- Long explanations inside controls.
- Calling historical data an official prediction.

## 10. Recommended Additional Features

### Priority 1 - Include in the redesign

1. Public formation explorer.
2. Compare up to three formations.
3. Reuse a selected participant score across other formations.
4. Data-confidence labels and source visibility.
5. Institution data-coverage page.

### Priority 2 - Build after the core redesign

1. Manual score simulation for users not found in the database.
2. Target-score calculator showing the suggested score increase by subtest.
3. Local recent-history list for RSKD codes without requiring login.
4. Real WhatsApp job-status tracking on the handoff page.
5. Share preview showing the user-safe, masked result card before WhatsApp delivery.

### Priority 3 - Later product expansion

1. CPNS 2026 official formation-data switch when announcements are available.
2. Historical year comparison when multiple clean years exist.
3. Personalized alerts for newly published target formations, only with explicit consent.
4. Saved shortlist and account system if repeated usage proves valuable.

## 11. Deliberate Non-Goals

- News portal or CPNS article feed.
- Full tryout platform inside this product phase.
- Public leaderboard of participant names.
- AI chat box on every page.
- Full analysis displayed on the website before WhatsApp.
- Predictions presented as guaranteed results.
- Editing or publishing dataset controls in the public UI.

## 12. Success Metrics

### Funnel

- Search started.
- Search returned results.
- Participant selected.
- Rationalization form completed.
- RSKD code created.
- Code received on WhatsApp.
- Analysis delivered.

### Product quality

- Search response time.
- No-result rate.
- Wrong-record backtrack rate.
- Code-to-WhatsApp conversion.
- Analysis delivery success rate.
- Formation comparison usage.
- Recommendation confidence distribution.

### Initial targets

- At least 70% of successful searches continue to participant preview.
- At least 55% of created codes are sent to WhatsApp.
- At least 95% of accepted WhatsApp jobs deliver successfully.
- Formation lists remain responsive with server-side pagination.

## 13. Release Plan

### Phase 1 - Visual foundation and core flow

- Integrate AnalisaCPNS logo, favicon, metadata, and tokens.
- Redesign header and footer.
- Replace the long landing page with search-first home.
- Redesign search results, participant preview, rationalization setup, and WhatsApp handoff.
- Preserve existing business logic and routes.

### Phase 2 - Public data utility

- Add formation explorer and formation detail.
- Add compare-three-formations workflow.
- Connect `Use my score` from participant results.
- Add methodology and data-coverage pages.

### Phase 3 - Simulation and retention

- Add manual score simulation.
- Add target-score calculator.
- Add local recent-code history and real job status.
- Prepare official CPNS 2026 data mode.

## 14. Acceptance Criteria for the Redesign

- The first mobile and desktop viewport exposes the real search tool.
- AnalisaCPNS is the dominant brand signal, with Mimin CPNS as a secondary endorsement.
- A user can complete search -> verify -> configure -> WhatsApp without confusion.
- Existing result-session and WhatsApp behavior remains functional.
- Historical data is visibly labeled and never presented as official future results.
- Tables and controls do not overflow incoherently on mobile.
- All interactive controls are keyboard accessible and have visible focus states.
- Loading, empty, error, and limited-data states explain the next action.
- The design uses the Rankline A identity consistently without decorative clutter.
- Production build and desktop/mobile browser checks pass before deployment.

## 15. Proposed First Implementation Slice

Implement Phase 1 in this order:

1. Brand component, tokens, favicon, and metadata.
2. Shared public header/footer and responsive navigation.
3. Search-first home and result list.
4. Participant position preview.
5. Rationalization setup.
6. WhatsApp handoff.
7. Cross-device visual QA and copy cleanup.

The formation explorer should begin only after this core flow is stable, because it introduces a new public data surface and additional query behavior.
