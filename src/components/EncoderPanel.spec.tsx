import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncodeResult } from '../types.js';
import { EASYPAL_MODES } from '../utils/EasyPalEncoder.js';
import { EncoderPanel } from './EncoderPanel.js';

describe('EncoderPanel', () => {
  const mockOnResult = vi.fn<[EncodeResult], void>();
  const mockOnError = vi.fn<[string], void>();
  const mockOnReset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the encoder panel with mode selector', () => {
    render(<EncoderPanel onResult={mockOnResult} onError={mockOnError} onReset={mockOnReset} />);

    expect(screen.getByText('Encoder')).toBeInTheDocument();
    expect(screen.getByLabelText('EasyPal Mode')).toBeInTheDocument();
  });

  it('renders all EasyPal modes in the dropdown', () => {
    render(<EncoderPanel onResult={mockOnResult} onError={mockOnError} onReset={mockOnReset} />);

    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));

    expect(options).toHaveLength(Object.keys(EASYPAL_MODES).length);
    expect(options.map((o) => o.value)).toEqual(Object.keys(EASYPAL_MODES));
  });

  it('allows changing the selected mode', async () => {
    const user = userEvent.setup();
    render(<EncoderPanel onResult={mockOnResult} onError={mockOnError} onReset={mockOnReset} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('ROBOT36');

    await user.selectOptions(select, 'PD120');
    expect(select.value).toBe('PD120');
  });

  it('renders dropzone with file input', () => {
    render(<EncoderPanel onResult={mockOnResult} onError={mockOnError} onReset={mockOnReset} />);

    expect(screen.getByText('Drag & drop or')).toBeInTheDocument();
    expect(screen.getByText('Choose File')).toBeInTheDocument();
    
    const input = document.getElementById('encode-input');
    expect(input).toHaveAttribute('accept', 'image/*');
  });
});
