/**
 * Google AdSense placements.
 *
 * ============================================================================
 * PASTE YOUR AD SLOT IDS BELOW.
 *
 * The publisher id is already set — it is the one in the loader script in
 * index.html. Each placement *additionally* needs its own ad unit, created at
 *
 *   adsense.google.com -> Ads -> By ad unit -> Display ads
 *
 * Creating one hands you a `data-ad-slot` number like "1234567890". Paste it
 * against the matching key here.
 *
 * A placement whose slot is still empty renders nothing at all in a build, and
 * a labelled dashed outline under `npm run dev`, so the layout stays verifiable
 * while the real units are pending and the live site never shows a dead gap.
 * Filling in only some of them is fine.
 * ============================================================================
 */

export const AD_CLIENT = 'ca-pub-7711499728620769';

export type AdPlacementId = 'headerLeft' | 'headerRight' | 'footer' | 'donate';

export interface AdPlacement {
  /** `data-ad-slot` from the AdSense ad unit. Empty means "not set up yet". */
  slot: string;
  /** `data-ad-format`. 'horizontal' keeps banner shapes out of tall boxes. */
  format: 'auto' | 'horizontal' | 'rectangle';
  /**
   * Lets AdSense span the full viewport width on small screens. Only sensible
   * where the placement really is full-bleed; inside a grid cell it produces an
   * ad wider than its container.
   */
  fullWidthResponsive: boolean;
  /**
   * Height held open before the ad arrives, so filling it does not shove the
   * page around. Roughly the shortest shape AdSense serves for that format.
   */
  reserveHeight: number;
  /** Only shown in the dev placeholder, to identify the box on screen. */
  note: string;
}

export const AD_PLACEMENTS: Record<AdPlacementId, AdPlacement> = {
  headerLeft: {
    slot: '',
    format: 'horizontal',
    fullWidthResponsive: false,
    reserveHeight: 90,
    note: 'header, left of the wordmark',
  },
  headerRight: {
    slot: '',
    format: 'horizontal',
    fullWidthResponsive: false,
    reserveHeight: 90,
    note: 'header, right of the wordmark',
  },
  footer: {
    slot: '',
    format: 'horizontal',
    fullWidthResponsive: true,
    reserveHeight: 90,
    note: 'foot of the page',
  },
  donate: {
    slot: '',
    format: 'rectangle',
    fullWidthResponsive: true,
    reserveHeight: 250,
    note: 'donate screen, below Back',
  },
};

export const adConfigured = (id: AdPlacementId): boolean =>
  AD_PLACEMENTS[id].slot.trim().length > 0;

/** True once any unit is live — used to decide whether to mention ads in copy. */
export const anyAdConfigured = (): boolean =>
  (Object.keys(AD_PLACEMENTS) as AdPlacementId[]).some(adConfigured);
