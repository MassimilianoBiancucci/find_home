import { Listing } from './models';

/** A listing issue (backend domain/issues.py): what is missing, and whether the ad lacks it or the extraction should
 *  be checked. The list rows carry only the codes; the listing page gets the full issues. */
export interface Issue { code: string; label: string; cls?: 'not_in_source' | 'check_extraction'; hint?: string; }

export const ISSUE_LABEL: Record<string, string> = {
  move_in_missing: 'No move-in date', photos_missing: 'No photos', floorplan_missing: 'No floor plan',
  description_missing: 'No description', address_partial: 'No street number', coords_missing: 'Not on the map',
  coords_approximate: 'Approximate map point', rent_missing: 'No rent', size_missing: 'No size',
  rooms_missing: 'No room count', page_translated: 'Page read stopped: translated', none: 'No issues',
};
export const ISSUE_CLASS_LABEL = { not_in_source: 'not in the ad', check_extraction: 'check the extraction' } as const;

export const issuesOf = (l: Listing): Issue[] => (l.issue_codes ?? []).map((code) => ({ code, label: ISSUE_LABEL[code] ?? code }));
