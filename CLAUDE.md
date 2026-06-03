# ¿Hay Sol? — Design System Skill

You are building **¿Hay Sol?** — a mobile-first Barcelona terrace sun/shade app.
Read this file before touching any UI. These rules are non-negotiable.

---

## Brand identity

**What it is:** A bold, warm, illustrated, joyful web app for Barcelona locals and expats.
**Tone:** Mediterranean. Hand-made with love. Not corporate, not tourist-brochure, not minimalist.
**Reference feeling:** A creative Barcelona local made this. Colourful, a little playful, not childish.
**Do not:** Add generic SaaS polish, dashboard layouts, grey cards, or corporate spacing.

---

## Colour tokens (already in Tailwind config — use class names, not raw hex)

| Token | Class | Hex | Use |
|-------|-------|-----|-----|
| Sunflower yellow | `bg-sun` / `text-sun` | `#F7C948` | Dominant hero background |
| Terracotta orange | `bg-terracotta` / `text-terracotta` | `#E8622A` | Primary accent, CTAs, "Sol" in headline |
| Warm coral | `bg-coral` / `text-coral` | `#FF6B4A` | Hover states |
| Deep cobalt | `bg-cobalt` / `text-cobalt` | `#1B3A8C` | Shade/sombra contrast — use sparingly |
| Near-black | `text-foreground` | `#1A1A1A` | Body text on yellow |
| White | `text-background` | `#FFFFFF` | Text on dark/cobalt |
| Sun dot (map) | — | `#FFD700` | Map markers in sun |
| Shade dot (map) | — | `#3DAA6B` | Map markers in shade |

Yellow is the dominant colour. Cobalt is the contrast — represents shade. Use it sparingly.

---

## Typography

- **Display / headlines:** `font-display font-bold` — Nunito, Fredoka, or Poppins Bold. Rounded, warm, character.
- **Body / UI:** `font-sans` — Poppins Regular or Inter. Clean and readable.
- **The app name** "¿Hay Sol?" is always large, bold, confident — never small or logo-treated.
- **"Sol" in the headline** is always `text-terracotta`.

---

## Layout rules

- **Mobile-first.** Design for 390px (iPhone 14) first.
- No sidebars. No dense information panels. No navigation bars.
- Max content width: `max-w-5xl` on desktop, full-width on mobile.
- Sections are full-screen (`h-screen` or `min-h-screen`).
- Buttons: rounded-full, bold, shadow, tactile active state.

---

## Animation principles

**Library:** Framer Motion (already installed as `motion/react`). Use it for everything.

**Core rules:**
- Nothing should be static if it can breathe gently.
- Entrances: fade-up (opacity: 0, y: 30 → opacity: 1, y: 0), duration 0.6s, easeOut.
- Stagger children with 0.1–0.15s delay.
- Scroll-triggered animations: use useScroll + useTransform. Never whileInView for scroll-linked values.
- Hover states: subtle scale (1.02–1.05) or colour shift only.
- The sun arc on page load must follow a smooth parametric arc (25+ cosine/sine keyframes), NOT discrete jump points.

**Sun arc on page load:**
- Starts bottom-left, arcs through the sky, rests upper-right.
- Rotates 360° as it travels.
- Uses ease: "easeInOut" across the full 2.5s duration.
- Generated with parametric arc math — NOT manually placed keyframe points.

**Drink fill animation (scroll-triggered, Section 1 to Section 2):**
- Vermut glass: half-full on load. Liquid rises to full as user scrolls. Olive drops in (spring physics: stiffness 300, damping 20).
- Beer (canya): same liquid rise. No ice/olive.
- Liquid fill: absolute-positioned element clipped to glass interior shape, animate height via useTransform.
- Olive drop: translateY from -80px to 0, spring animation, triggers mid-scroll.

---

## Illustration style

Flat, hand-drawn style. Warm. Mediterranean.

**Existing assets in /src/assets/:**
- bottle.png — Vichy Catalán glass bottle
- vermut.png — vermouth glass, half-full
- canya.png — beer glass
- sun.png — illustrated sun with rays
- olive.png — olive on cocktail pick
- orange.png — orange slice
- flower.png — small decorative flower

Decorative elements scatter asymmetrically at slight rotations (-15° to +15°). Never in uniform rows or grids.

---

## Component patterns

**Primary button (dark):**
rounded-full bg-foreground text-background py-5 px-6 font-display font-semibold
shadow-[0_6px_0_rgba(0,0,0,0.15)] active:translate-y-[2px] transition-all

**Secondary button (terracotta):**
rounded-full bg-terracotta text-primary-foreground py-4 px-6 font-display font-semibold
shadow-[0_6px_0_rgba(0,0,0,0.15)] hover:bg-coral

**Input pill:**
rounded-full bg-background/80 backdrop-blur px-4 py-3 border border-foreground/10

**Fade-up entrance:**
initial: { opacity: 0, y: 30 }
animate/whileInView: { opacity: 1, y: 0 }
transition: { duration: 0.6, ease: "easeOut" }

---

## What NOT to build

Never add without being explicitly asked:
- User sign-in or account creation
- Reviews, ratings, or photo galleries
- Filter panels or neighbourhood dropdowns
- Navigation menus or header bars
- Footer with links
- Grey skeleton/loading states
- Explanatory text blocks
- Desktop-first or dashboard-style layouts
- Any colour outside the defined tokens
