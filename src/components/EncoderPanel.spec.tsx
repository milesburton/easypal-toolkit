import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncodeResult } from '../types.js';
import { EncoderPanel } from './EncoderPanel.js';

describe('EncoderPanel', () => {
  const mockOnResult = vi.fn<(result: EncodeResult) => void>();
  const mockOnError = vi.fn<(msg: string) => void>();
  const mockOnReset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the encoder panel heading', () => {
    render(<EncoderPanel onResult={mockOnResult} onError={mockOnError} onReset={mockOnReset} />);
    expect(screen.getByText('Encoder')).toBeInTheDocument();
  });

  it('renders the DRM mode subtitle', () => {
    render(<EncoderPanel onResult={mockOnResult} onError={mockOnError} onReset={mockOnReset} />);
    expect(screen.getByText(/DRM Mode B/i)).toBeInTheDocument();
  });

  it('renders the best-effort warning', () => {
    render(<EncoderPanel onResult={mockOnResult} onError={mockOnError} onReset={mockOnReset} />);
    expect(screen.getByText(/Best-effort/i)).toBeInTheDocument();
  });

  it('renders dropzone with image file input', () => {
    render(<EncoderPanel onResult={mockOnResult} onError={mockOnError} onReset={mockOnReset} />);

    expect(screen.getByText('Drag & drop or')).toBeInTheDocument();
    expect(screen.getByText('Choose File')).toBeInTheDocument();

    const input = document.getElementById('encode-input');
    expect(input).toHaveAttribute('accept', 'image/*');
  });

  it('calls onError when a non-image file is provided', async () => {
    render(<EncoderPanel onResult={mockOnResult} onError={mockOnError} onReset={mockOnReset} />);

    const input = document.getElementById('encode-input') as HTMLInputElement;
    const audioFile = new File(['data'], 'test.wav', { type: 'audio/wav' });

    Object.defineProperty(input, 'files', { value: [audioFile], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      expect(mockOnError).toHaveBeenCalledWith(expect.stringContaining('image'));
    });
  });
});
