# Eysept Engineering — Landing Page Build Plan (for Google AI Studio)

> **How to use this file:** Paste the whole document into Google AI Studio (Build mode) and say:
> *"Build this website exactly as specified in this plan. Start with the Global Setup and Section 1–12, then iterate on polish."*
> Everything marked `[PLACEHOLDER]` must be replaced with real company facts before launch. **Do not invent statistics, awards, or client names.**

---

## 0. Purpose & Positioning

**Company:** Eysept Engineering
**Domain/industry:** Energy & power engineering (same space as a modern global energy company: clean energy, grid, storage, flexible/firm capacity, and energy technology) — scaled as an **engineering, design and delivery partner** rather than a utility owner.
**Reference studied:** aes.com (structure and storytelling pattern only; no copy, imagery, logos, awards, product names or trademarks are to be reused).

**Goal of the landing page:** Position Eysept Engineering as a credible, innovative energy engineering partner; generate qualified project inquiries (customers), recruit talent, and give investors/partners/suppliers a clear path.

**Primary audiences (mirrors reference site's audience nav):** Customers · Talent · Partners/Investors · Suppliers · Landowners

**Primary CTA:** "Talk to our engineers" (contact/inquiry form)
**Secondary CTAs:** "Explore solutions", "Life at Eysept", "Partner with us"

---

## 1. What the Reference Site Does (Analysis Summary)

| Area | Observed pattern on aes.com | How Eysept adapts it |
|---|---|---|
| Top bar | Careers · Investors · Contact, customer portal login, language selector | Careers · Partners · Contact, "Client Portal" (placeholder), EN (+ optional language switch) |
| Main nav | About · Solutions · Impact · News & Insights | About · Solutions · Impact · Insights (+ Projects) |
| Hero | Big outcome headline ("Leading energy innovation"), subline about AI/electrification demand, one CTA, full-bleed photo of engineers on site | Own headline, one CTA, full-bleed engineer-on-site image/video |
| Solutions cards | 5 cards, each with short copy + "Explore" (flexible capacity, carbon-free energy, LNG, grid infrastructure, powered land) | 6 original service cards (see §5) |
| Innovation stat + feature | Award stat, then a featured technology (robotics) | "Innovation" block with a flagship Eysept capability/tool `[PLACEHOLDER]` |
| Dual CTA band | Careers + Investor relations side by side | Careers + Partners side by side |
| Insights carousel | 5 article cards (projects, partnerships, tech) | 4–6 insight/case-study cards |
| Awards carousel | 6 badge cards | "Certifications & Recognition" strip `[PLACEHOLDER]` — only real ones |
| Footer | Common searches, audience links, legal, socials, copyright | Same structure |
| Tone | Professional, approachable, action verbs (powering, accelerating, delivering), "together with our customers" | Same tone |
| Visuals | Clean white base, blue + green accents, real photography of workers in PPE, solar, wind, storage, aerial | Same feel, own palette, own photography |

**Key messaging themes to echo (in original words):** diversified energy for rising demand (AI/data centers, electrification, reindustrialization) · reliability + speed + scale · global reach with local expertise · innovation culture.

---

## 2. Tech & Build Constraints (tell AI Studio)

- **Stack:** React + Vite + TypeScript + Tailwind CSS (single-page, section-anchored). Single `App.tsx` with components split per section is fine.
- **Icons:** `lucide-react`. **Animation:** `motion` (framer-motion) for subtle fade/slide on scroll.
- **Fonts:** Google Fonts — headings *Plus Jakarta Sans* (600/700), body *Inter* (400/500).
- **Responsive:** mobile-first; breakpoints sm 640 / md 768 / lg 1024 / xl 1280. Max content width 1280px, 24px side padding (16px on mobile).
- **Accessibility:** WCAG AA contrast, visible focus rings, semantic landmarks (`header/nav/main/section/footer`), alt text on all images, `prefers-reduced-motion` respected, carousels keyboard-operable.
- **Performance:** lazy-load below-fold images, use `loading="lazy"`, `aspect-ratio` boxes to avoid layout shift.
- **Images:** use Unsplash/Pexels-style royalty-free placeholders via `https://images.unsplash.com/...` or `https://picsum.photos/seed/<name>/1600/900`; keep a single `images.ts` map so real photos can be swapped in.
- **Forms:** contact form is front-end only (validation + success state); wire to Formspree/Netlify/Google Apps Script later.
- **SEO:** `<title>`, meta description, OpenGraph tags, JSON-LD `Organization` schema.

---

## 3. Design System

### Brand
- **Name:** Eysept Engineering (wordmark: "Eysept" bold + "ENGINEERING" small caps, letter-spaced, beneath/right).
- **Logo:** simple placeholder — a rounded square with a stylized "E" formed by three horizontal bars (suggesting power lines/layers). `[PLACEHOLDER: replace with real logo]`

### Color tokens (original palette — not AES's)
| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0B1F2E` | Primary text, dark sections |
| `--navy` | `#0E3A5B` | Headings accent, nav hover |
| `--electric` | `#1E7BFF` | Primary buttons, links |
| `--green` | `#19B26B` | Sustainability accents, success |
| `--amber` | `#FFB020` | Small highlight / energy spark (use sparingly) |
| `--mist` | `#F4F7FA` | Alternate section background |
| `--line` | `#DCE4EC` | Borders/dividers |
| `--white` | `#FFFFFF` | Base |

Gradient accent: `linear-gradient(135deg, #1E7BFF 0%, #19B26B 100%)` for thin bars, stat numbers, hover underlines.

### Typography scale
- H1: 56/60 desktop, 36/40 mobile, weight 700, tight tracking
- H2: 40/46 desktop, 28/34 mobile, weight 700
- H3: 22/30, weight 600
- Body: 17/28, Lead paragraph 20/32, Caption 14/20
- Eyebrow labels: 13px uppercase, letter-spacing .12em, `--electric`

### Components
- **Button primary:** `--electric` bg, white text, 12px radius, 14×24 padding, hover darken + arrow slides 4px.
- **Button secondary:** white bg, 1px `--line` border → hover border `--electric`.
- **Button ghost on dark:** transparent, white border.
- **Card:** white, 16px radius, 1px `--line`, soft shadow on hover (`0 12px 32px rgba(11,31,46,.10)`), image on top (16:10), 24px padding.
- **Section spacing:** 96px vertical desktop, 64px mobile.
- **Dividers:** 1px `--line` or 4px gradient bar 64px wide under section eyebrows.

---

## 4. Global Layout

```
[Utility bar]   Careers · Partners · Contact · Client Portal · EN
[Header/nav]    Logo | About | Solutions | Projects | Impact | Insights | [Talk to our engineers]
[Main]          Sections 1–12 below
[Footer]
```

- Header is **sticky**, transparent over hero → solid white with shadow after 40px scroll.
- Desktop nav uses **mega-dropdown on hover/focus** for "Solutions" and "About" (see §5.2); mobile uses full-screen slide-in drawer with accordion groups.

---

## 5. Section-by-Section Specification

### 5.1 Utility Bar (top, 36px, `--ink` bg, white 13px text)
Left: "Engineering the energy transition" (tagline, hidden on mobile)
Right: Careers · Partners · Contact · Client Portal (opens modal "Portal coming soon" `[PLACEHOLDER]`) · Language `EN ▾`

### 5.2 Header / Navigation
Items and dropdowns:
- **About** → Who we are · Our story · Leadership `[PLACEHOLDER]` · Careers · Innovation
- **Solutions** → Flexible & firm capacity · Clean power (solar, wind, storage) · Grid & transmission engineering · Gas & LNG-ready infrastructure · Power-ready sites · Digital & automation
- **Projects** → Featured projects · Case studies
- **Impact** → People & communities · Planet · Safety & accountability
- **Insights** → Newsroom · Articles · Trending topics
- CTA button (right): **Talk to our engineers**

### 5.3 Hero (full viewport, min 88vh)
- **Background:** full-bleed photo/video of engineers in hard hats and hi-vis reviewing plans at a solar field or substation at golden hour; dark gradient overlay (`rgba(11,31,46,.65)` → transparent left-to-right) for text contrast.
- **Eyebrow:** `ENERGY ENGINEERING`
- **H1:** "Engineering the power behind what's next."
- **Lead:** "From data centers to factories to whole communities, demand for reliable energy is growing faster than ever. Eysept Engineering designs and delivers the clean, flexible and resilient power systems that keep up."
- **Buttons:** Primary **Meet Eysept** (scrolls to About) · Secondary-ghost **Explore solutions**
- **Bottom of hero:** scroll cue + a slim 3-item trust row: "Design · Build · Optimize" with icons.
- Animation: headline lines fade up sequentially (400ms stagger).

### 5.4 Intro / Value Statement (white)
- Eyebrow: `WHO WE ARE`
- H2: "One engineering partner for the full energy lifecycle."
- Two-column: left paragraph — "Eysept Engineering brings together power-systems engineers, project developers and digital specialists to take energy projects from concept to commissioning — faster, safer and with fewer surprises."
- Right: 3 mini-points with icons — **Reliability** (systems built to perform when it matters) · **Speed** (streamlined design-to-delivery) · **Scale** (from single sites to multi-site portfolios).

### 5.5 Solutions Cards (mist background) — mirrors reference's 5-card block
Eyebrow `SOLUTIONS`, H2 "Energy solutions built for rising demand."
Grid: 3 cols desktop / 2 tablet / 1 mobile. Six cards, each: image, icon chip, title, 2-line copy, **Explore →**.

1. **Flexible capacity** — "Fast-responding power and storage that keeps grids stable as demand and renewables swing."
2. **Clean power** — "Solar, wind and battery storage engineered for performance and long-term value."
3. **Grid infrastructure** — "Interconnection, substations and transmission design that get projects online reliably."
4. **Gas & LNG-ready infrastructure** — "Efficient, lower-emission firm capacity and fuel-flexible facilities for resilient supply."
5. **Powered land** — "Development-ready sites with power, permits and access already in motion."
6. **Digital & automation** — "Monitoring, controls and analytics that squeeze more output from every asset."

Hover: card lifts 4px, image zooms 1.04, arrow nudges.

### 5.6 Impact Numbers Strip (dark `--ink` bg)
Four large gradient numbers with labels — **all values are `[PLACEHOLDER]`; use real figures only:**
`[XX]+ Projects delivered` · `[XX] GW Capacity engineered` · `[XX] Countries / regions served` · `[XX]+ Engineers & specialists`
Count-up animation when scrolled into view (once).

### 5.7 Innovation Feature (white, split layout)
Mirrors the reference's "award stat + flagship technology" pair.
- Left: image of a field robot / drone / digital-twin dashboard (placeholder).
- Right: Eyebrow `INNOVATION` · H2 "Where engineering meets technology." · Paragraph: "We invest in digital twins, AI-assisted design and automated field tools so projects are built faster and operate smarter." · Bullet list of 3 capabilities `[PLACEHOLDER: replace with real Eysept tools]` · Link **Explore innovation →**
- Beneath: small badge row "Innovation highlights" `[PLACEHOLDER: only real recognitions]`.

### 5.8 Featured Projects (mist)
Eyebrow `PROJECTS`, H2 "Delivering at scale."
3 large cards with image, location tag, capacity/size tag, one-line outcome. All `[PLACEHOLDER]` e.g. "Utility-scale solar + storage — [Region] — [XX] MW". Link **View all projects →**.

### 5.9 Dual CTA Band — Careers + Partners (mirrors Careers/Investors band)
Two equal large panels side by side (stack on mobile), each with image bg + overlay:
- **Careers:** Eyebrow `LIFE AT EYSEPT` · "Build a career that powers the future." · Button **Explore careers**
- **Partners & Investors:** Eyebrow `PARTNER WITH US` · "Grow with a team engineered for the long term." · Button **Partner with us**

### 5.10 Latest Insights Carousel (white)
Eyebrow `NEWS & INSIGHTS`, H2 "Latest from Eysept."
Horizontal scroll-snap carousel with arrow buttons + dots; 5 cards: image, category chip, title, date, **Read more**. Sample (original, replace `[PLACEHOLDER]`):
1. "How data-center growth is reshaping grid planning"
2. "Solar plus storage: lessons from the field"
3. "Why flexible capacity is the grid's quiet hero"
4. "Digital twins for faster commissioning"
5. "Safety first: our approach on site"

### 5.11 Certifications & Recognition (mist)
Carousel/strip of 4–6 badge cards (logo, one-line description). **Only real items** — e.g. ISO 9001/14001/45001, safety record, industry memberships. Fill as `[PLACEHOLDER: ISO 9001]`, etc. If none yet, hide section.

### 5.12 Contact / Inquiry (dark navy, gradient edge)
Eyebrow `GET IN TOUCH`, H2 "Let's engineer your next project."
Left: short paragraph + contact details `[PLACEHOLDER: email, phone, address]` + audience quick-links (Customers · Talent · Partners · Suppliers · Landowners).
Right: form — Name*, Work email*, Company, I am a… (dropdown: Customer / Talent / Partner / Supplier / Landowner / Media), Project type (dropdown of the 6 solutions), Message*, consent checkbox, **Send message**. Inline validation + success toast.

### 5.13 Footer (`--ink`, white text)
- **Row 1:** Logo + one-line mission; "Common searches" chips: *Solar engineering · Energy storage · Grid interconnection · Careers · Case studies*
- **Row 2 columns:** Audiences (Customers, Talent, Partners/Investors, Suppliers, Landowners) · Company (About, Newsroom, Contact, Careers) · Solutions (6 links) · Legal (Terms & conditions, Privacy policy, Accessibility, Cookie preferences)
- **Row 3:** social icons (LinkedIn, X, YouTube, Instagram, Facebook) · "© 2026 Eysept Engineering. All rights reserved."
- Cookie banner (bottom-left, dismissible, stores choice in `localStorage`).

---

## 6. Interactions & Motion
- Scroll reveal: fade + 16px upward, 500ms, once per element.
- Sticky header state change; active-section highlighting in nav.
- Carousels: scroll-snap, arrow + keyboard support, drag on touch.
- Mega-menu: opens on hover/focus, closes on Esc/blur.
- Smooth anchor scrolling with 80px offset for the sticky header.
- Respect `prefers-reduced-motion` (disable parallax/count-up).

---

## 7. Content & Voice Guidelines
- **Tone:** professional, confident, approachable. Short sentences. Active verbs: *powering, designing, delivering, accelerating, connecting.*
- Use "we/our" and "together with our customers and partners."
- Avoid unverifiable superlatives ("#1", "world's leading") unless proven.
- Every claim with a number must be backed by real data (`[PLACEHOLDER]` until supplied).
- Sentence-case headings (not Title Case).

---

## 8. Legal / Originality Checklist
- ❌ Do **not** use AES's logo, name, product names (e.g., Maximo), award badges, photos, or copied text.
- ✅ All copy above is original; imagery must be licensed/royalty-free or owned.
- ✅ Add real company registration/address in footer before launch `[PLACEHOLDER]`.
- ✅ Privacy policy + cookie notice pages needed before collecting form data.

---

## 9. Build Order (iterate in AI Studio prompts)
1. **Prompt 1:** Project scaffold, design tokens, fonts, header/utility bar, footer.
2. **Prompt 2:** Hero + Intro + Solutions cards.
3. **Prompt 3:** Stats strip, Innovation feature, Projects.
4. **Prompt 4:** Dual CTA band, Insights carousel, Certifications.
5. **Prompt 5:** Contact form with validation, cookie banner.
6. **Prompt 6:** Motion polish, accessibility pass, mobile QA, SEO meta.
7. **Prompt 7:** Replace placeholders with real content/logo/photos.

## 10. Acceptance Criteria
- [ ] All 12 sections render in order, responsive at 375 / 768 / 1280 px.
- [ ] Lighthouse: Performance ≥ 85, Accessibility ≥ 95, SEO ≥ 95.
- [ ] No horizontal scroll on mobile; nav drawer works with keyboard.
- [ ] Contact form validates and shows success state.
- [ ] No leftover lorem ipsum; all `[PLACEHOLDER]` items listed in a TODO comment at top of `App.tsx`.

## 11. Open Items for the Owner (Eysept)
- Real logo, brand colors (if different), and photography
- Verified stats, certifications, project list
- Leadership/about copy, contact details, legal entity info
- Which solutions Eysept actually offers (trim/adjust the 6 cards)
- Target regions/languages
