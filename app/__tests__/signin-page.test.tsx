// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let search = '';
const signinRedirect = vi.fn(async () => {});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('@/frontend/auth/oidc', () => ({
  getOidcManager: () => ({ signinRedirect }),
}));

import SignInPage from '@/app/signin/page';
import ErrorPage from '@/app/error';
import Loading from '@/app/loading';

beforeEach(() => {
  search = '';
  signinRedirect.mockClear();
});
afterEach(cleanup);

describe('sign-in page', () => {
  it('renders the Cashight heading and Cloudscape sign-in buttons', () => {
    const { container } = render(<SignInPage />);
    expect(screen.getByRole('heading', { name: 'Cashight' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to track your spending.')).toBeInTheDocument();
    expect(screen.getByText('Private single-user workspace')).toBeInTheDocument();
    const buttons = createWrapper(container).findAllButtons().map((b) => b.getElement().textContent);
    expect(buttons).toEqual(['Sign in with Google', 'Sign in with Cognito']);
  });

  it('signs in with Google through the identity provider hint', async () => {
    render(<SignInPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(signinRedirect).toHaveBeenCalledWith({ extraQueryParams: { identity_provider: 'Google' } });
  });

  it('shows an access-denied alert from ?error=AccessDenied', () => {
    search = 'error=AccessDenied';
    const { container } = render(<SignInPage />);
    const alert = createWrapper(container).findAlert();
    expect(alert?.getElement()).toHaveTextContent("That account isn't allowed to access this app.");
  });
});

describe('error boundary page', () => {
  it('shows the message in an error alert and retries', async () => {
    const reset = vi.fn();
    const { container } = render(<ErrorPage error={new Error('Boom')} reset={reset} />);
    expect(createWrapper(container).findAlert()?.getElement()).toHaveTextContent('Boom');
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe('loading page', () => {
  it('shows a Cloudscape loading status', () => {
    const { container } = render(<Loading />);
    expect(createWrapper(container).findStatusIndicator()?.getElement()).toHaveTextContent('Loading');
  });
});
