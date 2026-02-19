import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DecodeDiagnostics } from '../types.js';
import { DiagnosticsPanel } from './DiagnosticsPanel.js';

describe('DiagnosticsPanel', () => {
  const mockDiagnostics: DecodeDiagnostics = {
    mode: 'ROBOT36',
    visCode: 0x08,
    sampleRate: 44100,
    fileDuration: '35.2s',
    freqOffset: 12,
    autoCalibrate: true,
    visEndPos: 4410,
    decodeTimeMs: 1234,
    quality: {
      rAvg: 128,
      gAvg: 127,
      bAvg: 129,
      brightness: 128,
      verdict: 'good',
      warnings: [],
    },
  };

  it('renders diagnostics panel with header', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('Diagnostics')).toBeInTheDocument();
  });

  it('displays mode information', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('Mode')).toBeInTheDocument();
    expect(screen.getByText('ROBOT36')).toBeInTheDocument();
  });

  it('displays VIS code in hex and decimal', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('VIS code')).toBeInTheDocument();
    expect(screen.getByText('0x08 (8)')).toBeInTheDocument();
  });

  it('displays sample rate', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('Sample rate')).toBeInTheDocument();
    expect(screen.getByText('44100 Hz')).toBeInTheDocument();
  });

  it('displays file duration', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('File duration')).toBeInTheDocument();
    expect(screen.getByText('35.2s')).toBeInTheDocument();
  });

  it('displays frequency offset with sign', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('Freq offset')).toBeInTheDocument();
    expect(screen.getByText('+12 Hz')).toBeInTheDocument();
  });

  it('highlights large frequency offset', () => {
    const diagnostics = { ...mockDiagnostics, freqOffset: -75 };
    render(<DiagnosticsPanel diagnostics={diagnostics} />);

    const offsetElement = screen.getByText('-75 Hz');
    expect(offsetElement).toHaveClass('text-amber-400');
  });

  it('displays auto-calibrate status', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('Auto-calibrate')).toBeInTheDocument();
    expect(screen.getByText('on')).toBeInTheDocument();
  });

  it('displays VIS end position', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('VIS end pos')).toBeInTheDocument();
    expect(screen.getByText('4410 samples')).toBeInTheDocument();
  });

  it('displays decode time', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('Decode time')).toBeInTheDocument();
    expect(screen.getByText('1234 ms')).toBeInTheDocument();
  });

  it('displays image quality metrics when available', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('Image Quality')).toBeInTheDocument();
    expect(screen.getByText(/R:128/)).toBeInTheDocument();
    expect(screen.getByText(/G:127/)).toBeInTheDocument();
    expect(screen.getByText(/B:129/)).toBeInTheDocument();
  });

  it('displays quality verdict badge', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('can toggle panel open/closed', async () => {
    const user = userEvent.setup();
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);

    const toggleButton = screen.getByRole('button', { name: /diagnostics/i });

    // Initially open (default)
    expect(screen.getByText('ROBOT36')).toBeInTheDocument();
    expect(toggleButton).toHaveTextContent('▲');

    // Close panel
    await user.click(toggleButton);
    expect(screen.queryByText('ROBOT36')).not.toBeInTheDocument();
    expect(toggleButton).toHaveTextContent('▼');

    // Open panel again
    await user.click(toggleButton);
    expect(screen.getByText('ROBOT36')).toBeInTheDocument();
    expect(toggleButton).toHaveTextContent('▲');
  });

  it('handles missing diagnostics fields gracefully', () => {
    const minimalDiagnostics: DecodeDiagnostics = {
      mode: null,
      visCode: null,
      sampleRate: 0,
      fileDuration: null,
      freqOffset: 0,
      autoCalibrate: false,
      visEndPos: null,
      decodeTimeMs: null,
      quality: null,
    };

    render(<DiagnosticsPanel diagnostics={minimalDiagnostics} />);

    // Should render em-dashes for missing values
    const emDashes = screen.getAllByText('—');
    expect(emDashes.length).toBeGreaterThan(0);
  });

  it('does not display quality section when quality is null', () => {
    const diagnosticsNoQuality = { ...mockDiagnostics, quality: null };
    render(<DiagnosticsPanel diagnostics={diagnosticsNoQuality} />);

    expect(screen.queryByText('Image Quality')).not.toBeInTheDocument();
    expect(screen.queryByText('Good')).not.toBeInTheDocument();
  });
});
