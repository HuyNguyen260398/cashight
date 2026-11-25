import type { PaginationProps } from '@cloudscape-design/components/pagination';

/** Explicit so tables are labelled even outside the root I18nProvider (tests). */
export const PAGINATION_LABELS: PaginationProps.Labels = {
  nextPageLabel: 'Next page',
  previousPageLabel: 'Previous page',
  pageLabel: (pageNumber) => `Page ${pageNumber}`,
};
