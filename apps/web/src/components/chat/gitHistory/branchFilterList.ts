// FILE: branchFilterList.ts
// Purpose: Pure rules for the filter popover's branch checklist: the local name filter
//          and the compact date shown next to each branch.
// Layer: Git history UI helper
// Exports: branchMatchesFilter, formatBranchDate

import type { TimestampFormat } from "~/appSettings";
import { formatShortDateTimestamp } from "~/timestampFormat";
import { getFormatLocale } from "~/i18n";

/** True when the query is blank or appears in the name, case-insensitively. */
export function branchMatchesFilter(name: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle.length === 0 || name.toLowerCase().includes(needle);
}

/**
 * The branch tip's date in the pane's calendar format (`Jan 5, 2025`), or null when git
 * reported none. Null means the row shows nothing: no `—` placeholder.
 */
export function formatBranchDate(
  isoDate: string | undefined,
  timestampFormat: TimestampFormat,
  locale = getFormatLocale(),
): string | null {
  if (!isoDate) return null;
  // Validate here so an unparseable value renders nothing; the shared formatter would
  // otherwise print "Invalid Date" straight into the row.
  if (Number.isNaN(new Date(isoDate).getTime())) return null;
  return formatShortDateTimestamp(isoDate, timestampFormat, locale);
}
