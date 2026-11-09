/**
 * A row of targets has to stay at least 44 wide, and seven or nine of them do not fit across a
 * 320-pixel phone in one line. Splitting into rows keeps the controls in their original order and
 * lets each one grow, rather than shrinking every one below the size the brief asks for.
 */
export const touchRows = <T>(items: readonly T[], perRow: number): T[][] => {
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += perRow) rows.push(items.slice(start, start + perRow));
  return rows;
};
