// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/app/components/console/notifications', () => ({ notify: vi.fn() }));
const start = vi.fn();
vi.mock('@/frontend/hooks/use-upload-job', () => ({
  useUploadJob: () => ({ state: { phase: 'idle' }, start, reset: vi.fn() }),
}));

import { notify } from '@/app/components/console/notifications';
import { UploadDropzone } from '../components/upload-dropzone';
afterEach(cleanup);

it.each(['TPBank', 'VIB'] as const)('offers an accessible PDF input on %s', (bank) => {
  render(<UploadDropzone bank={bank} />);
  expect(screen.getByLabelText('Statement PDF')).toHaveAttribute('type', 'file');
  expect(screen.getByText(bank === 'TPBank' ? /Drag a TPB statement/ : /Drag a VIB statement/)).toBeVisible();
  expect(screen.getByText(/detected automatically/i)).toBeVisible();
});

it('uses Cloudscape file dropzone and input', () => {
  const { container } = render(<UploadDropzone bank="TPBank" />);
  expect(createWrapper(container).findFileDropzone()).not.toBeNull();
  expect(createWrapper(container).findFileInput()).not.toBeNull();
});

it('starts an upload for a PDF', async () => {
  start.mockClear();
  render(<UploadDropzone bank="TPBank" />);
  const pdf = new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' });
  await userEvent.upload(screen.getByLabelText('Statement PDF'), pdf);
  expect(start).toHaveBeenCalledWith(pdf);
});

it('rejects non-PDF files', async () => {
  start.mockClear();
  render(<UploadDropzone bank="TPBank" />);
  const png = new File(['x'], 'photo.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText('Statement PDF'), png, { applyAccept: false });
  expect(start).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith({ type: 'error', content: 'Only PDF files are accepted.' });
});

it('rejects PDFs over 5 MB', async () => {
  start.mockClear();
  render(<UploadDropzone bank="TPBank" />);
  const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' });
  await userEvent.upload(screen.getByLabelText('Statement PDF'), big);
  expect(start).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith({ type: 'error', content: 'File is too large (max 5 MB).' });
});
