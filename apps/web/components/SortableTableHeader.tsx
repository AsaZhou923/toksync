import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDirection } from "../lib/sort";

interface SortableTableHeaderProps<T extends string> {
  field: T;
  activeField: T;
  direction: SortDirection;
  children: string;
}

export function SortableTableHeader<T extends string>({
  field,
  activeField,
  direction,
  children,
}: SortableTableHeaderProps<T>) {
  const active = field === activeField;
  const nextDirection: SortDirection =
    active && direction === "desc" ? "asc" : "desc";
  const Icon = active
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  const params = new URLSearchParams({ sort: field, dir: nextDirection });

  return (
    <th aria-sort={active ? ariaSortValue(direction) : undefined}>
      <a
        aria-label={`${children}, sort ${nextDirection}`}
        className={`sort-link${active ? " active" : ""}`}
        href={`?${params.toString()}`}
      >
        <span>{children}</span>
        <Icon aria-hidden="true" size={13} />
      </a>
    </th>
  );
}

function ariaSortValue(direction: SortDirection) {
  return direction === "asc" ? "ascending" : "descending";
}
