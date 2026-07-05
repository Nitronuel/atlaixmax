import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApplicationsAdminPage } from './BetaApplicationsAdminPage';
import { BetaApplicationService, type BetaApplication } from './beta-application-service';

vi.mock('./beta-application-service', () => ({
  BetaApplicationService: {
    listApplications: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    resend: vi.fn(),
    delete: vi.fn()
  }
}));

const applications: BetaApplication[] = [
  {
    id: 'pending-application',
    fullName: 'Pending Applicant',
    email: 'pending@example.com',
    xUsername: null,
    telegramUsername: null,
    intendedUse: 'Find early token risk.',
    status: 'pending',
    inviteExpiresAt: null,
    inviteSentAt: null,
    approvedAt: null,
    rejectedAt: null,
    registeredAt: null,
    registeredUserId: null,
    reviewedBy: null,
    createdAt: '2026-07-05T20:00:00.000Z',
    updatedAt: '2026-07-05T20:00:00.000Z'
  },
  {
    id: 'registered-application',
    fullName: 'Registered Applicant',
    email: 'registered@example.com',
    xUsername: '@registered',
    telegramUsername: '@registered',
    intendedUse: 'Track wallets.',
    status: 'registered',
    inviteExpiresAt: null,
    inviteSentAt: null,
    approvedAt: '2026-07-05T20:05:00.000Z',
    rejectedAt: null,
    registeredAt: '2026-07-05T20:10:00.000Z',
    registeredUserId: 'registered-user',
    reviewedBy: 'admin-user',
    createdAt: '2026-07-05T20:01:00.000Z',
    updatedAt: '2026-07-05T20:10:00.000Z'
  }
];

describe('BetaApplicationsAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(BetaApplicationService.listApplications).mockResolvedValue({ applications });
    vi.mocked(BetaApplicationService.delete).mockResolvedValue({ application: applications[0] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads all applications for accurate counts and filters client-side', async () => {
    render(<BetaApplicationsAdminPage />);

    expect(await screen.findByText('Pending Applicant')).toBeInTheDocument();
    expect(screen.getByText('Registered Applicant')).toBeInTheDocument();
    expect(BetaApplicationService.listApplications).toHaveBeenCalledWith('all');

    expect(within(screen.getByRole('button', { name: /Pending/ })).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Registered/ })).getByText('1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Pending/ }));

    expect(screen.getByText('Pending Applicant')).toBeInTheDocument();
    expect(screen.queryByText('Registered Applicant')).not.toBeInTheDocument();
  });

  it('lets admins delete an application after confirmation', async () => {
    render(<BetaApplicationsAdminPage />);

    expect(await screen.findByText('Pending Applicant')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /Delete/ })[0]);

    expect(window.confirm).toHaveBeenCalledWith("Delete Pending Applicant's beta application? This cannot be undone.");
    expect(BetaApplicationService.delete).toHaveBeenCalledWith('pending-application');
    expect(await screen.findByText('Application deleted.')).toBeInTheDocument();
    expect(BetaApplicationService.listApplications).toHaveBeenCalledTimes(2);
  });
});
