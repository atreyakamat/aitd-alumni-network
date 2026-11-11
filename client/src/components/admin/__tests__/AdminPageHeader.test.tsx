import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';

describe('<AdminPageHeader>', () => {
  it('renders the title as the one and only h1', () => {
    render(<AdminPageHeader title="Audit log" />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Audit log');
  });

  it('shows the description when given and nothing when not', () => {
    const { rerender } = render(<AdminPageHeader title="Audit log" description="Who did what, and when." />);
    expect(screen.getByText('Who did what, and when.')).toBeInTheDocument();
    rerender(<AdminPageHeader title="Audit log" />);
    expect(screen.queryByText('Who did what, and when.')).not.toBeInTheDocument();
  });

  it('renders the actions slot next to the title', () => {
    render(<AdminPageHeader title="Videos" actions={<button type="button">Upload video</button>} />);
    expect(screen.getByRole('button', { name: 'Upload video' })).toBeInTheDocument();
  });

  it('renders a decorative icon that is hidden from assistive technology', () => {
    const { container } = render(<AdminPageHeader title="Members" icon={Users} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('puts a badge beside the title without making it part of the heading text', () => {
    render(<AdminPageHeader title="Moderation queue" badge={<span>3 pending</span>} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Moderation queue$/);
    expect(screen.getByText('3 pending')).toBeInTheDocument();
  });

  it('does not add a back link: the section navigation does that job', () => {
    render(<AdminPageHeader title="Members" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
