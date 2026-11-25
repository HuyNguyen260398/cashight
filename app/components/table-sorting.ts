import type { TableProps } from '@cloudscape-design/components/table';

/**
 * Cloudscape sorts ascending on a column's first activation; Cashight's tables
 * have always started descending (newest / largest first). Wrap a
 * useCollection table's sorting handler to keep that.
 */
export function descendingFirst<T>(
  current: TableProps.SortingColumn<T> | undefined,
  setSorting: (state: TableProps.SortingState<T>) => void,
): TableProps['onSortingChange'] {
  return ({ detail }) => {
    const sameColumn = detail.sortingColumn.sortingField === current?.sortingField;
    setSorting({ sortingColumn: detail.sortingColumn, isDescending: sameColumn ? detail.isDescending : true });
  };
}
