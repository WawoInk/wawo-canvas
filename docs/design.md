---

version: alpha
name: Canvan AI Oceanic Design System
description: A futuristic AI creation platform design system inspired by deep ocean blues, electric cyan energy, and intelligent digital experiences.

colors:

  # Brand colors

  primary: "#0A6CFE"
  primary-hover: "#0586FD"
  primary-active: "#01AEFD"
  secondary: "#01C7FD"
  tertiary: "#0CE0FC"

  # Dark mode palette

  dark-background: "#060F30"
  dark-surface: "#0B163D"
  dark-surface-elevated: "#12204D"
  dark-border: "#1D3A68"
  dark-text-primary: "#FDFDFD"
  dark-text-secondary: "#B8C7E8"
  dark-text-muted: "#7183A8"

  # Light mode palette

  light-background: "#F7FAFF"
  light-surface: "#FFFFFF"
  light-surface-elevated: "#EEF5FF"
  light-border: "#D7E5FF"
  light-text-primary: "#060F30"
  light-text-secondary: "#34466D"
  light-text-muted: "#64748B"

  # Semantic colors

  success: "#16C784"
  warning: "#FFB020"
  error: "#FF4D6D"
  info: "#0A6CFE"

typography:
  headline-display:
    fontFamily: Inter
    fontSize: 56px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.2

spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  xxl: 96px

rounded:
  none: 0px
  sm: 6px
  md: 10px
  lg: 16px
  xl: 24px
  full: 9999px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.light-surface-elevated}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.light-surface}"
    borderColor: "{colors.light-border}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.light-surface}"
    borderColor: "{colors.light-border}"
    rounded: "{rounded.md}"
---

# Canvan AI Oceanic Design System

## Overview

The visual identity is inspired by the Canvan logo's futuristic blue energy.

The design language represents:

* artificial intelligence
* creative generation
* cloud computing
* digital exploration

The interface should feel:

* intelligent
* premium
* futuristic
* clean
* trustworthy

Avoid playful consumer-product aesthetics. The product should feel like a professional AI creation platform.

The primary visual metaphor is **deep ocean combined with electric energy**:

* dark blue represents intelligence and depth
* cyan represents creation and acceleration
* glowing blue accents represent AI activity

---

## Colors

The color system uses a dual-mode strategy.

### Dark Mode

Dark mode is the primary immersive experience.

The background uses deep navy tones instead of pure black to preserve the brand feeling.

* **Dark Background (#060F30):**
  The main application background. Represents deep digital space.

* **Dark Surface (#0B163D):**
  Used for cards, panels, sidebars, and containers.

* **Primary Blue (#0A6CFE):**
  The main interaction color. Used for buttons, active states, and important actions.

* **Electric Cyan (#01C7FD):**
  Used for AI generation states, gradients, highlights, and futuristic effects.

* **White Text (#FDFDFD):**
  Used for high-priority content.

### Light Mode

Light mode keeps the same brand identity while improving readability.

* **Light Background (#F7FAFF):**
  Soft blue-white canvas background.

* **White Surface (#FFFFFF):**
  Used for cards and floating containers.

* **Primary Blue (#0A6CFE):**
  Maintains brand recognition.

* **Dark Navy Text (#060F30):**
  Provides strong contrast.

Do not use pure black (#000000) or pure gray backgrounds.

---

## Typography

Typography should feel modern and technical.

Use Inter as the primary typeface.

Hierarchy:

* Large headlines should feel confident and cinematic.
* Body text should prioritize readability.
* Metadata and technical information should use smaller labels.

Avoid excessive font weights. Use:

* 400 for normal content
* 500 for labels
* 600-700 for important hierarchy

---

## Layout

The layout follows an 8px spacing grid.

The product should use a spacious SaaS layout:

* large breathing areas
* clear information hierarchy
* modular cards
* strong alignment

Recommended desktop structure:

* Maximum content width: 1280px
* Sidebar width: 240-280px
* Card padding: 24px
* Section spacing: 48px

---

## Elevation & Depth

Depth should be created through layered surfaces rather than heavy shadows.

Dark mode:

* use subtle blue glow
* use transparent borders
* use cyan highlights for active AI states

Light mode:

* use soft shadows
* use elevation through white surfaces
* avoid excessive gradients

AI generation states may use:

* cyan glow
* animated gradients
* subtle light effects

---

## Shapes

The design uses modern rounded geometry.

Rules:

* Cards: 16px radius
* Buttons: 10px radius
* Inputs: 10px radius
* Pills/tags: fully rounded

Avoid sharp rectangular interfaces.

The product should feel approachable while maintaining professional AI tooling characteristics.

---

## Components

### Buttons

Primary actions:

* blue background
* white text
* subtle glow on hover

Secondary actions:

* transparent or light surface
* blue text
* thin border

Avoid using multiple competing accent colors.

---

### Cards

Cards should create clear content grouping.

Dark mode:

* navy surface
* subtle blue border
* minimal shadow

Light mode:

* white surface
* soft blue border
* gentle shadow

---

### AI Generation States

AI processing states should use cyan-blue energy effects.

Recommended:

* animated gradient borders
* cyan glow
* progress indicators

Avoid:

* red/orange AI states
* random rainbow gradients

---

## Do's and Don'ts

### Do

* Use blue/cyan as the main identity system
* Maintain strong contrast between surfaces
* Use gradients only for AI-related moments
* Keep interfaces clean and spacious
* Make primary actions visually obvious

### Don't

* Don't use pure black backgrounds
* Don't introduce unrelated accent colors
* Don't overuse gradients
* Don't make every element glow
* Don't mix warm colors with the oceanic palette
