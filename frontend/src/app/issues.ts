import { Listing } from './models';

/** A listing issue (backend domain/issues.py): what is missing, and whether the ad lacks it or the extraction should
 *  be checked. The list rows carry only the codes; the listing page gets the full issues. */
export interface Issue { code: string; label: string; cls?: 'not_in_source' | 'check_extraction' | 'attention'; hint?: string;
  /** A short fact shown apart from the label, never broken across lines ("ends 31 May 2027"). */
  detail?: string; }

export const ISSUE_LABEL: Record<string, string> = {
  move_in_missing: 'No move-in date', photos_missing: 'No photos', floorplan_missing: 'No floor plan',
  description_missing: 'No description', address_partial: 'No street number', coords_missing: 'Not on the map',
  coords_approximate: 'Approximate map point', rent_missing: 'No rent', size_missing: 'No size',
  rooms_missing: 'No room count', page_translated: 'Page read stopped: translated', contract_fixed_term: 'Fixed-term contract',
  none: 'No issues',
};
/** "2027-05-31" → "31 May 2027". */
const dayText = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const ISSUE_CLASS_LABEL = { not_in_source: 'not in the ad', check_extraction: 'check the extraction', attention: 'worth knowing' } as const;

export const issuesOf = (l: Listing): Issue[] => (l.issue_codes ?? []).map((code) => code === 'contract_fixed_term'
  ? { code, label: 'Fixed-term contract', cls: 'attention' as const, detail: l.contract_end ? `ends ${dayText(l.contract_end)}` : undefined,
      hint: 'The contract ends on a set date: you would have to move again then.' }
  : { code, label: ISSUE_LABEL[code] ?? code });
