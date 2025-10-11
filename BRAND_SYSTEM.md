# Goolets Brand System - Implementation Guide

## Overview

This document describes how the Goolets brand system maps to design tokens and components throughout the app.

## Brand Foundations

### Colors
- **Primary (Champagne Gold)**: `#B39262` - Accent color for CTAs, highlights, charts
- **Foreground (Graphite Black)**: `#121212` - Text, headings, dark UI elements
- **Background (Ivory)**: `#FAF8F5` - Main page background
- **Background Secondary (Sand)**: `#F5F1EB` - Card backgrounds, subtle contrast

### Typography

#### Font Families
- **Headings (H1-H3)**: Sigvar-Serial (serif) - Luxury, elegant
- **Body/UI**: Inter (sans-serif) - Clean, readable
- **Decorative**: HamiltonScript (script) - Sparingly for special accents only

#### Type Scale
- **H1**: 2.5rem/40px (Sigvar-Serial, font-weight: 600)
- **H2**: 2rem/32px (Sigvar-Serial, font-weight: 600)
- **H3**: 1.5rem/24px (Sigvar-Serial, font-weight: 600)
- **H4**: 1.25rem/20px (Inter, font-weight: 600)
- **Body**: 1rem/16px (Inter, font-weight: 400)
- **Small**: 0.875rem/14px (Inter, font-weight: 400)

### Spacing
- Uses Tailwind's 4px base scale
- Generous whitespace for luxury feel
- Minimum 24px margins around key content areas

### Border Radius
- Sophisticated rounded corners: 8px default
- Buttons/inputs: 6px
- Cards: 12px

## Token Mapping

### CSS Variables (`globals.css`)

```css
--primary: Champagne Gold (#B39262)
--foreground: Graphite Black (#121212)
--background: Ivory (#FAF8F5)
--card: White/Sand for contrast
--muted: Sand (#F5F1EB)
--accent: Gold variants for hover/focus
--border: Light grey for subtle divisions
```

### Tailwind Classes

#### Colors
- `bg-background` → Ivory page background
- `bg-card` → White/Sand card background
- `text-foreground` → Graphite Black text
- `text-primary` → Champagne Gold accent text
- `border-primary` → Gold borders
- `hover:bg-primary` → Gold hover states

#### Typography
- `font-serif` → Sigvar-Serial (headings)
- `font-sans` → Inter (body)
- `font-script` → HamiltonScript (special accents)

## Component Patterns

### Navigation
- Logo: 24-28px height, left-aligned
- Background: Ivory with subtle border
- Links: Graphite Black, Gold on hover
- Settings icon: Graphite Black

### Buttons
```tsx
// Primary (Gold)
<Button className="bg-primary text-primary-foreground hover:bg-primary/90">

// Secondary (Outlined)
<Button variant="outline" className="border-primary text-primary hover:bg-primary/10">

// Ghost (Subtle)
<Button variant="ghost" className="hover:bg-muted">
```

### Cards (KPI Metrics)
```tsx
<Card className="bg-card border-border hover:border-primary transition-all">
  <CardContent>
    <h3 className="font-serif text-2xl">Metric Value</h3>
    <p className="text-muted-foreground">Label</p>
  </CardContent>
</Card>
```

### Tables
- Header: Sand background (#F5F1EB)
- Rows: Hover with subtle gold tint
- Borders: Light grey
- Selected: Gold border/background tint

### Charts
- Primary line/bar: Champagne Gold (#B39262)
- Secondary: Graphite Black tints
- Grid lines: Light grey (#E5E5E5)
- Labels: Graphite Black, Inter font

### Empty States
```tsx
<div className="text-center py-16">
  <p className="font-serif text-3xl text-foreground mb-4">
    Your favourite memory in the making.
  </p>
  <p className="text-muted-foreground">
    Connect your Google Ads account to begin.
  </p>
</div>
```

### Export Covers
- Background: Graphite Black (#121212)
- Headline: Champagne Gold, Sigvar-Serial
- Logo: Top-right or bottom-center
- Tagline: "Luxury, within your reach." in small Inter

## Brand Voice

### Headlines & CTAs
- **Hero**: "Luxury, within your reach."
- **Empty State**: "Your favourite memory in the making."
- **Success**: "The next story you'll tell, starts here."
- Use sparingly - not on every screen

### Tone
- Sophisticated but approachable
- Confident without being pushy
- Focus on experiences and memories
- Avoid: overly corporate, salesy, cluttered messaging

## Logo Usage

### Placement
- **Navigation**: Left-aligned, 24-28px height
- **Footer**: Centered, 32px height
- **Exports**: Corner or centered, appropriate to context
- **Do NOT**: Place in every card, overshadow content

### Formats
- **Light backgrounds**: Dark logo (`logo-dark.svg`)
- **Dark backgrounds**: Light/gold logo (`logo-light.svg`)
- **Minimum size**: 20px height
- **Clear space**: 16px minimum on all sides

## Accessibility

### Contrast Ratios
- Gold on Ivory: 3.5:1 (AA for large text)
- Black on Ivory: 16:1 (AAA)
- Gold on Black: 4.8:1 (AA)
- Always test with tools: https://webaim.org/resources/contrastchecker/

### Focus States
- 2px solid Champagne Gold ring
- 2px offset for clarity
- Visible on all interactive elements

## File Structure

```
/public/branding/
  /logo/
    - logo-dark.svg (for light backgrounds)
    - logo-light.svg (for dark backgrounds)
    - icon-only.svg
  /fonts/
    - sigvar-serial-{weights}.woff2
    - inter-{weights}.woff2
    - hamilton-script.woff2
  palette.md (this file)

/src/app/globals.css
  - CSS custom properties for colors
  - Font-face declarations

/tailwind.config.ts
  - Extended theme with brand colors
  - Custom font families
```

## Implementation Checklist

- [ ] Update CSS variables in `globals.css`
- [ ] Configure Tailwind with brand colors
- [ ] Add font-face declarations
- [ ] Update Navigation component
- [ ] Restyle MetricCard component
- [ ] Update Button variants
- [ ] Apply typography to headings
- [ ] Restyle Charts with gold accent
- [ ] Add empty state messaging
- [ ] Update export templates
- [ ] Test contrast ratios
- [ ] Verify logo placement

## Quick Reference

| Element | Font | Color | Size |
|---------|------|-------|------|
| H1 | Sigvar-Serial | Graphite Black | 40px |
| H2 | Sigvar-Serial | Graphite Black | 32px |
| H3 | Sigvar-Serial | Graphite Black | 24px |
| Body | Inter | Graphite Black | 16px |
| Button Primary | Inter | White on Gold | 16px |
| Links | Inter | Gold | 16px |
| Muted Text | Inter | Grey 600 | 14px |

## Support

For questions or clarifications about brand implementation, refer to the full Goolets Brand Book or consult with the design team.

