import type { Theme } from '@cloudscape-design/components/theming';

/**
 * Cashight's take on the refreshed AWS console look: square corners, a
 * near-black dark palette, neutral (not blue) buttons, underlined links, and a
 * blue accent kept only for "Info" links, selection and focus.
 *
 * Cloudscape's theming module is client-only, so the stylesheet is generated
 * ahead of time into app/console-theme.generated.css (imported by the root
 * layout, in place before first paint). After editing this file run:
 *
 *   pnpm theme:generate
 */

const SQUARE = '0px';

const FONT_STACK =
  "'Amazon Ember', 'Inter Variable', 'Inter', 'Helvetica Neue', Roboto, Arial, sans-serif";

// Palette. Dark values were sampled from the AWS console's new dark mode;
// light values mirror them on a white canvas.
const c = {
  canvas: { light: '#fafafa', dark: '#121212' },
  surface: { light: '#ffffff', dark: '#161616' },
  raised: { light: '#ffffff', dark: '#1c1c1c' },
  hover: { light: '#f0f0f0', dark: '#242424' },
  active: { light: '#e4e4e4', dark: '#2e2e2e' },
  border: { light: '#d4d4d4', dark: '#3a3a3a' },
  divider: { light: '#e5e5e5', dark: '#2b2b2b' },
  control: { light: '#6b6b6b', dark: '#8a8a8a' },
  text: { light: '#161616', dark: '#ececec' },
  heading: { light: '#0a0a0a', dark: '#f5f5f5' },
  muted: { light: '#5c5c5c', dark: '#a3a3a3' },
  // Primary action: inverted neutral (black on light, near-white on dark).
  primary: { light: '#161616', dark: '#e8e8e8' },
  primaryHover: { light: '#000000', dark: '#ffffff' },
  onPrimary: { light: '#ffffff', dark: '#0f0f0f' },
  accent: { light: '#0b63e5', dark: '#5c9aff' },
  accentHover: { light: '#0a4fb8', dark: '#8ab6ff' },
};

export const consoleTheme: Theme = {
  tokens: {
    // ── Typography ─────────────────────────────────────────────────────────
    fontFamilyBase: FONT_STACK,
    fontFamilyHeading: FONT_STACK,
    fontFamilyDisplay: FONT_STACK,
    // The console sets headings and big figures at a medium weight, not bold.
    fontWeightHeadingXl: '600',
    fontWeightHeadingL: '600',
    fontWeightHeadingM: '600',
    fontWeightHeadingS: '600',
    fontWeightHeadingXs: '600',
    fontWeightDisplayL: '500',
    fontWeightDisplayXl: '500',

    // ── Square corners everywhere ──────────────────────────────────────────
    borderRadiusActionCardDefault: SQUARE,
    borderRadiusActionCardEmbedded: SQUARE,
    borderRadiusAlert: SQUARE,
    borderRadiusBadge: SQUARE,
    borderRadiusButton: SQUARE,
    borderRadiusCalendarDayFocusRing: SQUARE,
    borderRadiusCardDefault: SQUARE,
    borderRadiusCardEmbedded: SQUARE,
    borderRadiusContainer: SQUARE,
    borderRadiusControlDefaultFocusRing: SQUARE,
    borderRadiusDialog: SQUARE,
    borderRadiusDropdown: SQUARE,
    borderRadiusDropzone: SQUARE,
    borderRadiusFlashbar: SQUARE,
    borderRadiusInput: SQUARE,
    borderRadiusItem: SQUARE,
    borderRadiusPopover: SQUARE,
    borderRadiusSideNavigationItem: SQUARE,
    borderRadiusSideNavigationItemCollapsed: SQUARE,
    borderRadiusStatusIndicator: SQUARE,
    borderRadiusTabsFocusRing: SQUARE,
    borderRadiusTiles: SQUARE,
    borderRadiusToken: SQUARE,
    borderRadiusTokenInline: SQUARE,
    borderRadiusTutorialPanelItem: SQUARE,
    borderWidthButton: '1px',

    // ── Surfaces ───────────────────────────────────────────────────────────
    colorBackgroundLayoutMain: c.canvas,
    colorBackgroundLayoutPanelContent: c.canvas,
    colorBackgroundLayoutToolbar: c.canvas,
    colorBackgroundContainerContent: c.surface,
    colorBackgroundContainerHeader: c.surface,
    colorBackgroundCard: c.surface,
    colorBackgroundHomeHeader: c.canvas,
    colorBackgroundDropdownItemDefault: c.raised,
    colorBackgroundDropdownItemHover: c.hover,
    colorBackgroundPopover: c.raised,
    colorBackgroundDialog: c.raised,
    colorBackgroundInputDefault: c.surface,
    colorBackgroundCellShaded: c.hover,
    colorBackgroundSegmentWrapper: c.surface,
    colorBackgroundSegmentDefault: c.surface,
    colorBackgroundSegmentHover: c.hover,
    colorBackgroundSegmentActive: c.primary,
    colorBackgroundSideNavigationItemActive: c.active,
    colorBackgroundLayoutToggleDefault: { light: 'transparent', dark: 'transparent' },
    colorBackgroundLayoutToggleHover: c.hover,
    colorBackgroundLayoutToggleActive: c.active,
    colorBackgroundLayoutToggleSelectedDefault: c.active,
    colorBackgroundLayoutToggleSelectedHover: c.hover,
    colorBackgroundLayoutToggleSelectedActive: c.active,

    // ── Borders ────────────────────────────────────────────────────────────
    colorBorderLayout: c.divider,
    colorBorderDividerDefault: c.divider,
    colorBorderDividerSecondary: c.divider,
    colorBorderContainerTop: { light: 'transparent', dark: 'transparent' },
    colorBorderDropdownContainer: c.border,
    colorBorderPopover: c.border,
    colorBorderInputDefault: c.control,
    colorBorderInputFocused: c.accent,
    colorBorderItemFocused: c.accent,
    colorBorderItemSelected: c.accent,
    colorBorderControlDefault: c.control,
    colorBorderSegmentDefault: c.control,
    colorBorderCard: c.border,

    // ── Text ───────────────────────────────────────────────────────────────
    colorTextBodyDefault: c.text,
    colorTextBodySecondary: c.muted,
    colorTextHeadingDefault: c.heading,
    colorTextHeadingSecondary: c.muted,
    colorTextFormSecondary: c.muted,
    colorTextLabel: c.muted,
    colorTextGroupLabel: c.muted,
    colorTextCounter: c.muted,
    colorTextTopNavigationTitle: c.heading,
    colorTextBreadcrumbCurrent: c.muted,
    colorTextAccent: c.accent,
    colorTextInteractiveDefault: c.text,
    colorTextInteractiveHover: c.heading,
    colorTextInteractiveActive: c.heading,
    colorTextSideNavigationItemActive: c.heading,

    // Links read as body text with an underline; the "Info" link keeps the blue.
    colorTextLinkDefault: c.text,
    colorTextLinkHover: c.heading,
    colorTextLinkDecorationDefault: c.muted,
    colorTextLinkDecorationHover: c.heading,
    colorTextLinkInfoDefault: c.accent,
    colorTextLinkInfoHover: c.accentHover,

    // ── Buttons ────────────────────────────────────────────────────────────
    colorBackgroundButtonNormalDefault: { light: 'transparent', dark: 'transparent' },
    colorBackgroundButtonNormalHover: c.hover,
    colorBackgroundButtonNormalActive: c.active,
    colorBorderButtonNormalDefault: c.control,
    colorBorderButtonNormalHover: c.heading,
    colorBorderButtonNormalActive: c.heading,
    colorTextButtonNormalDefault: c.heading,
    colorTextButtonNormalHover: c.heading,
    colorTextButtonNormalActive: c.heading,

    colorBackgroundButtonPrimaryDefault: c.primary,
    colorBackgroundButtonPrimaryHover: c.primaryHover,
    colorBackgroundButtonPrimaryActive: c.primary,
    colorBorderButtonPrimaryDefault: c.primary,
    colorBorderButtonPrimaryHover: c.primaryHover,
    colorBorderButtonPrimaryActive: c.primary,
    colorTextButtonPrimaryDefault: c.onPrimary,
    colorTextButtonPrimaryHover: c.onPrimary,
    colorTextButtonPrimaryActive: c.onPrimary,

    colorBackgroundButtonLinkHover: c.hover,
    colorBackgroundButtonLinkActive: c.active,
    colorTextButtonLinkDefault: c.heading,
    colorTextButtonLinkHover: c.heading,
    colorTextLinkButtonNormalDefault: c.heading,
    colorTextLinkButtonNormalHover: c.heading,

    // ── Selection / controls ───────────────────────────────────────────────
    colorBackgroundControlChecked: c.accent,
    colorBackgroundItemSelected: { light: '#eef4ff', dark: '#1a2538' },
    colorBackgroundDropdownItemSelected: { light: '#eef4ff', dark: '#1a2538' },
    colorTextSegmentActive: c.onPrimary,
    colorTextSegmentDefault: c.text,
    colorTextSegmentHover: c.heading,
  },
  contexts: {
    // Cloudscape always renders the top bar with dark-mode text, so it stays
    // near-black in both modes (as the AWS console's does), separated from a
    // dark page by a hairline (globals.css).
    'top-navigation': {
      tokens: {
        colorBackgroundContainerContent: c.canvas.dark,
        colorTextTopNavigationTitle: c.heading.dark,
        colorTextInteractiveDefault: c.text.dark,
        colorTextInteractiveHover: c.heading.dark,
      },
    },
    header: {
      tokens: {
        colorBackgroundLayoutMain: c.canvas,
      },
    },
  },
};
