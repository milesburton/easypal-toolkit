import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DecodeDiagnostics } from '../types.js';
import { DiagnosticsPanel } from './DiagnosticsPanel.js';

describe('DiagnosticsPanel', () => {
  const mockDiagnostics: DecodeDiagnostics = {
    mode: 'DRM Mode B',
    sampleRate: 44100,
    fileDuration: '4.80s',
    freqOffset: 12,
    transmissionMode: 'B',
    spectrumOccupancy: 'SO_0',
    fecRate: '1/2',
    snrDb: 18.5,
    framesDecoded: 12,
    segmentErrors: 0,
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
    expect(screen.getByText('DRM Mode B')).toBeInTheDocument();
  });

  it('displays transmission mode', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);
    expect(screen.getByText('Transmission mode')).toBeInTheDocument();
    expect(screen.getByText('Mode B')).toBeInTheDocument();
  });

  it('displays spectrum occupancy', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);
    expect(screen.getByText('Spectrum occupancy')).toBeInTheDocument();
    expect(screen.getByText('SO_0')).toBeInTheDocument();
  });

  it('displays FEC rate', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);
    expect(screen.getByText('FEC rate')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('displays sample rate', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);
    expect(screen.getByText('Sample rate')).toBeInTheDocument();
    expect(screen.getByText('44100 Hz')).toBeInTheDocument();
  });

  it('displays file duration', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);
    expect(screen.getByText('File duration')).toBeInTheDocument();
    expect(screen.getByText('4.80s')).toBeInTheDocument();
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

  it('displays SNR estimate', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);
    expect(screen.getByText('SNR (est.)')).toBeInTheDocument();
    expect(screen.getByText('18.5 dB')).toBeInTheDocument();
  });

  it('highlights low SNR', () => {
    const diagnostics = { ...mockDiagnostics, snrDb: 5 };
    render(<DiagnosticsPanel diagnostics={diagnostics} />);
    const snrElement = screen.getByText('5 dB');
    expect(snrElement).toHaveClass('text-amber-400');
  });

  it('displays frames decoded', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);
    expect(screen.getByText('Frames decoded')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('displays segment errors', () => {
    render(<DiagnosticsPanel diagnostics={mockDiagnostics} />);
    expect(screen.getByText('Segment errors')).toBeInTheDocument();
    // 0 errors renders as "0"
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('highlights non-zero segment errors', () => {
    const diagnostics = { ...mockDiagnostics, segmentErrors: 3 };
    render(<DiagnosticsPanel diagnostics={diagnostics} />);
    const errElement = screen.getByText('3');
    expect(errElement).toHaveClass('text-amber-400');
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

    // Initially open
    expect(screen.getByText('DRM Mode B')).toBeInTheDocument();
    expect(toggleButton).toHaveTextContent('▲');

    // Close panel
    await user.click(toggleButton);
    expect(screen.queryByText('DRM Mode B')).not.toBeInTheDocument();
    expect(toggleButton).toHaveTextContent('▼');

    // Open panel again
    await user.click(toggleButton);
    expect(screen.getByText('DRM Mode B')).toBeInTheDocument();
    expect(toggleButton).toHaveTextContent('▲');
  });

  it('handles missing optional diagnostics fields gracefully', () => {
    const minimalDiagnostics: DecodeDiagnostics = {
      mode: 'DRM Mode B',
      sampleRate: 0,
      fileDuration: null,
      freqOffset: 0,
      transmissionMode: null,
      spectrumOccupancy: null,
      fecRate: null,
      snrDb: null,
      framesDecoded: 0,
      segmentErrors: 0,
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
