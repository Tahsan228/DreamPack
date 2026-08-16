/**
 * Author credit, social links and donation options.
 *
 * ============================================================================
 * FILL IN YOUR OWN URLS BELOW. Any entry left as an empty string is hidden
 * from the UI rather than rendered as a dead link, so the app stays tidy until
 * you get round to it.
 * ============================================================================
 */

export const AUTHOR = 'Tahsan';

export interface LinkEntry {
  id: string;
  /** Short label — Minecraftia has no icon glyphs, so these are words. */
  label: string;
  url: string;
  /** Shown as a tooltip and on the donate page. */
  note?: string;
}

/**
 * Rendered in the top-left corner of the screen. `id` also selects the icon in
 * components/mc/icons.tsx — an id with no icon there just renders as a label.
 */
export const SOCIALS: LinkEntry[] = [
  {
    id: 'discord',
    label: 'Discord',
    url: 'https://discord.gg/bxcuAxBEYZ',
    note: 'Join the DreamPack Discord',
  },
];

/**
 * Rendered on the donate page. While an entry has no URL its button is shown
 * disabled with a "coming soon" note underneath, so the page reads as finished
 * rather than broken.
 */
export const DONATIONS: LinkEntry[] = [
  { id: 'paypal', label: 'PayPal', url: '', note: 'Direct, any amount' },
];

export const configured = (entries: LinkEntry[]): LinkEntry[] =>
  entries.filter((e) => e.url.trim().length > 0);
