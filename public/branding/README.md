# Goolets Branding Assets

## Required Files

### Fonts (`/fonts/`)
Place the following font files here:

- `sigvar-serial-regular.woff2` - Regular weight for headings
- `sigvar-serial-semibold.woff2` - Semibold (600) for emphasis
- `hamilton-script.woff2` - Decorative script (use sparingly)

**Note**: Inter is loaded via Google Fonts in `layout.tsx`

### Logos (`/logo/`)
Place the following logo files here:

- `logo-dark.svg` - Dark logo for light backgrounds (Graphite + Gold)
- `logo-light.svg` - Light logo for dark backgrounds (Ivory + Gold)
- `icon-only.svg` - Icon/symbol only (for favicons, small spaces)
- `logo-dark.png` - PNG fallback (2x resolution minimum)
- `logo-light.png` - PNG fallback (2x resolution minimum)

## Logo Specifications

### Sizing
- **Navigation**: 24-28px height
- **Footer**: 32px height  
- **Minimum size**: 20px height
- **Clear space**: 16px on all sides

### Usage
```tsx
// Light background (use dark logo)
<Image src="/branding/logo/logo-dark.svg" alt="Goolets" width={120} height={28} />

// Dark background (use light logo)
<Image src="/branding/logo/logo-light.svg" alt="Goolets" width={120} height={28} />
```

## Current Status

🟡 **Fallbacks Active**
- Logo: Using "Goolets" text with Sigvar-Serial font
- Fonts: Using Georgia (serif fallback) until brand fonts added

## How to Add Files

1. **Fonts**: Export from design tool as WOFF2 format
2. **Logos**: Export as SVG (optimized) and PNG @2x
3. **Place**: In respective folders (`/fonts/` or `/logo/`)
4. **Test**: Refresh app to see brand fonts load

## File Size Guidelines

- **Fonts**: < 50KB each (subset if needed)
- **SVG Logos**: < 10KB (optimize with SVGO)
- **PNG Logos**: < 30KB each (@2x resolution)

## Questions?

Refer to `BRAND_SYSTEM.md` in project root for complete implementation guide.

