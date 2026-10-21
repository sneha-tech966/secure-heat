import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/services/api';
import { asUser, mkUser, renderAt } from './helpers';

vi.mock('recharts', async () => (await import('./helpers')).rechartsStub());
vi.mock('../src/services/api', async (orig) => {
  const real = await orig<typeof import('../src/services/api')>();
  const names = Object.keys(real.api) as (keyof typeof real.api)[];
  return { ...real, api: Object.fromEntries(names.map((n) => [n, vi.fn(() => new Promise(() => {}))])) };   // pending by default
});
const A = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => { Object.values(A).forEach((f) => f.mockReset().mockImplementation(() => new Promise(() => {}))); });

describe('login', () => {
  it('shows the sign-in form and submits credentials', async () => {
    asUser(A, null); A.login.mockResolvedValue({ user: mkUser('ADMIN') });
    renderAt('/login'); const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Email'), 'admin@example.com'); await u.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await u.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(A.login).toHaveBeenCalledWith('admin@example.com', 'correct-horse-battery'));
  });
  it('shows the server error and stays on the page when credentials are wrong', async () => {
    asUser(A, null); A.login.mockRejectedValue({ response: { status: 401, data: { message: 'invalid email or password' } } });
    renderAt('/login'); const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Email'), 'a@b.co'); await u.type(screen.getByLabelText('Password'), 'wrong-password-1');
    await u.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid email or password');
  });
  it('disables submit until both fields are filled', async () => {
    asUser(A, null); renderAt('/login'); expect(await screen.findByRole('button', { name: /sign in/i })).toBeDisabled();
  });
});

describe('protected routes', () => {
  it('redirects unauthenticated visitors to the login page', async () => {
    asUser(A, null); renderAt('/sensors'); expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
  it('shows "Access restricted" when a viewer opens an analyst-only page, and does not call its API', async () => {
    asUser(A, mkUser('VIEWER')); renderAt('/quarantine');
    expect(await screen.findByText('Access restricted')).toBeInTheDocument(); expect(A.quarantine).not.toHaveBeenCalled();
  });
  it('lets a security analyst open Quarantine, but blocks Settings (admin only)', async () => {
    asUser(A, mkUser('SECURITY_ANALYST')); A.quarantine.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    renderAt('/quarantine'); expect(await screen.findByRole('heading', { name: 'Quarantine' })).toBeInTheDocument();
  });
  it('blocks an analyst from Settings', async () => { asUser(A, mkUser('SECURITY_ANALYST')); renderAt('/settings'); expect(await screen.findByText('Access restricted')).toBeInTheDocument(); });
  it('hides restricted navigation entries from a viewer', async () => {
    asUser(A, mkUser('VIEWER')); renderAt('/events'); await screen.findByRole('navigation');
    for (const hidden of ['Quarantine', 'ML Analytics', 'Simulator', 'Settings']) expect(screen.queryByRole('link', { name: hidden })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Security Events' })).toBeInTheDocument();
  });
});
