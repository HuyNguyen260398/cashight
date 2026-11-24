import Box from '@cloudscape-design/components/box';
import { categoryColor } from '@/lib/category-colors';

/**
 * Category name with its chart colour as a dot, so a table row matches its
 * slice in the category donut. The name is always shown, so colour is never
 * the only cue.
 */
export function CategoryLabel({ category }: { category: string }) {
  return (
    <Box display="inline-block">
      <span aria-hidden style={{ color: categoryColor(category), marginRight: 6 }}>
        ●
      </span>
      {category}
    </Box>
  );
}
