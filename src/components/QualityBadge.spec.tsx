import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QualityBadge } from './QualityBadge.js';

describe('QualityBadge', () => {
  it('renders "Good" badge with correct styling', () => {
    render(<QualityBadge verdict="good" />);

    const badge = screen.getByText('Good');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('quality-good');
  });

  it('renders "Warning" badge with correct styling', () => {
    render(<QualityBadge verdict="warn" />);

    const badge = screen.getByText('Warning');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('quality-warn');
  });

  it('renders "Poor" badge with correct styling', () => {
    render(<QualityBadge verdict="bad" />);

    const badge = screen.getByText('Poor');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('quality-bad');
  });

  it('renders nothing when verdict is undefined', () => {
    const { container } = render(<QualityBadge verdict={undefined} />);

    expect(container.firstChild).toBeNull();
  });

  it('has uppercase, bold, small text styling', () => {
    render(<QualityBadge verdict="good" />);

    const badge = screen.getByText('Good');
    expect(badge).toHaveClass('uppercase');
    expect(badge).toHaveClass('font-bold');
    expect(badge).toHaveClass('text-xs');
  });

  it('has proper spacing and rounded corners', () => {
    render(<QualityBadge verdict="good" />);

    const badge = screen.getByText('Good');
    expect(badge).toHaveClass('px-2');
    expect(badge).toHaveClass('py-0.5');
    expect(badge).toHaveClass('rounded-full');
  });
});
