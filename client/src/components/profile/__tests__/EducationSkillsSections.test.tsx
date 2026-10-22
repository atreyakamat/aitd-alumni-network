import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ok } from './mocks';

const toast = vi.hoisted(() => vi.fn());
const userApi = vi.hoisted(() => ({
  addEducation: vi.fn(),
  updateEducation: vi.fn(),
  deleteEducation: vi.fn(),
  updateSkills: vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  userApi,
}));

import { EducationSection } from '@/components/profile/EducationSection';
import { SkillsSection } from '@/components/profile/SkillsSection';

beforeEach(() => {
  toast.mockReset();
  userApi.addEducation.mockReset().mockResolvedValue(ok({ id: 'e1' }));
  userApi.updateEducation.mockReset().mockResolvedValue(ok({ id: 'e1' }));
  userApi.deleteEducation.mockReset().mockResolvedValue(ok());
  userApi.updateSkills.mockReset();
});

const dialog = () => screen.getByRole('dialog');

describe('<EducationSection>', () => {
  it('adds an education entry with numeric years', async () => {
    const onSaved = vi.fn();
    render(<EducationSection educations={[]} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add education' }));

    await userEvent.type(within(dialog()).getByLabelText('Institution'), 'AITD Kanpur');
    await userEvent.type(within(dialog()).getByLabelText('Degree'), 'B.Tech');
    await userEvent.type(within(dialog()).getByLabelText('Field of study'), 'Computer Science');
    await userEvent.type(within(dialog()).getByLabelText('Start year'), '2011');
    await userEvent.type(within(dialog()).getByLabelText('End year'), '2015');
    await userEvent.type(within(dialog()).getByLabelText('Grade'), '8.4 CGPA');
    await userEvent.click(within(dialog()).getByLabelText('This is my AITD degree'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add education' }));

    await waitFor(() =>
      expect(userApi.addEducation).toHaveBeenCalledWith({
        institution: 'AITD Kanpur',
        degree: 'B.Tech',
        fieldOfStudy: 'Computer Science',
        startYear: 2011,
        endYear: 2015,
        grade: '8.4 CGPA',
        isPrimary: true,
      })
    );
    expect(toast).toHaveBeenCalledWith({ title: 'Education added' });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('rejects an end year before the start year', async () => {
    render(<EducationSection educations={[]} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add education' }));
    await userEvent.type(within(dialog()).getByLabelText('Institution'), 'AITD');
    await userEvent.type(within(dialog()).getByLabelText('Degree'), 'M.Tech');
    await userEvent.type(within(dialog()).getByLabelText('Start year'), '2016');
    await userEvent.type(within(dialog()).getByLabelText('End year'), '2014');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add education' }));

    expect(within(dialog()).getByText('End year cannot be before start year')).toBeInTheDocument();
    expect(userApi.addEducation).not.toHaveBeenCalled();
  });

  it('deletes an entry after confirmation', async () => {
    render(
      <EducationSection
        educations={[{ id: 'e9', institution: 'AITD', degree: 'B.Tech', startYear: 2011, endYear: 2015, isPrimary: true }]}
        onSaved={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete B.Tech at AITD' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(userApi.deleteEducation).toHaveBeenCalledWith('e9'));
  });
});

describe('<SkillsSection>', () => {
  const skills = [{ skill: { id: 's1', name: 'React' } }, { skill: { id: 's2', name: 'Node.js' } }];
  const skillList = () => within(screen.getByRole('list', { name: 'Your skills' }));

  it('adds with Enter, removes, de-duplicates and PUTs the whole list', async () => {
    userApi.updateSkills.mockResolvedValue(ok([{ skill: { id: 's1', name: 'React' } }, { skill: { id: 's3', name: 'Go' } }]));
    const onSaved = vi.fn();
    render(<SkillsSection skills={skills} onSaved={onSaved} />);

    const save = screen.getByRole('button', { name: 'Save skills' });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Add a skill'), '  go {Enter}');
    expect(skillList().getByText('go')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Add a skill'), 'REACT{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('"REACT" is already in your skills.');
    expect(skillList().getAllByRole('listitem')).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: 'Remove Node.js' }));
    expect(skillList().queryByText('Node.js')).not.toBeInTheDocument();

    await userEvent.click(save);
    await waitFor(() => expect(userApi.updateSkills).toHaveBeenCalledWith(['React', 'go']));
    expect(toast).toHaveBeenCalledWith({ title: 'Skills saved' });
    // Re-syncs to what the server stored
    expect(await skillList().findByText('Go')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save skills' })).toBeDisabled();
    expect(onSaved).toHaveBeenCalled();
  });

  it('adds with the Add button and ignores blank input', async () => {
    userApi.updateSkills.mockResolvedValue(ok([]));
    render(<SkillsSection skills={[]} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Add a skill'), 'Kubernetes');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(skillList().getByText('Kubernetes')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a skill')).toHaveValue('');
  });

  it('rejects skills over 50 characters', async () => {
    render(<SkillsSection skills={[]} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Add a skill'));
    await userEvent.paste('x'.repeat(51));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(/at most 50 characters/);
  });
});
