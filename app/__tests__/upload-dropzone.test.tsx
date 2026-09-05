// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { UploadDropzone } from '../components/upload-dropzone';
afterEach(cleanup);

it.each(['TPBank', 'VIB'] as const)('offers an accessible PDF input on %s', (bank) => {
  render(<UploadDropzone bank={bank} />);
  expect(screen.getByLabelText('Statement PDF')).toHaveAttribute('type', 'file');
  expect(screen.getByText(bank === 'TPBank' ? /Drag a TPB statement/ : /Drag a VIB statement/)).toBeVisible();
  expect(screen.getByText(/detected automatically/i)).toBeVisible();
});
