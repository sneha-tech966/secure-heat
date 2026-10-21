import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import App from '../src/App';
import { AuthProvider } from '../src/context/AuthContext';
import { ToastProvider } from '../src/context/ToastContext';
import type { Role, User } from '../src/types/api';

export const mkUser = (role: Role): User => ({ id: `u-${role}`, name: `${role} user`, email: `${role.toLowerCase()}@example.com`, role });
/** Recharts measures the DOM, which jsdom cannot do; charts are covered by the pages' data/empty/error states instead. */
export const rechartsStub = () => { const P = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>; return new Proxy({}, { get: () => P }); };

export function renderAt(route: string, ui: ReactElement = <App />) {
  return render(<MemoryRouter initialEntries={[route]}><ToastProvider><AuthProvider>{ui}</AuthProvider></ToastProvider></MemoryRouter>);
}
export const asUser = (api: Record<string, unknown>, user: User | null) => { (api.me as ReturnType<typeof vi.fn>).mockImplementation(() => (user ? Promise.resolve({ user }) : Promise.reject({ response: { status: 401 } }))); };
