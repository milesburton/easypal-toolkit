import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GalleryEntry } from '../types.js';
import { GalleryPanel } from './GalleryPanel.js';

const ENTRIES: GalleryEntry[] = [
  {
    name: 'ISS Robot 36',
    audioFile: 'examples/iss-test.wav',
    imageFile: 'gallery/iss-test.png',
    mode: 'Robot 36',
    quality: 'good',
  },
  {
    name: 'Colour bars',
    audioFile: 'examples/test-colorbars.wav',
    imageFile: 'gallery/test-colorbars.png',
    mode: 'Robot 36',
    quality: 'good',
  },
];

describe('GalleryPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing while manifest is loading', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined));
    const { container } = render(<GalleryPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
    const { container } = render(<GalleryPanel />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders a card for each gallery entry', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve(ENTRIES),
    } as Response);

    render(<GalleryPanel />);

    await waitFor(() => {
      expect(screen.getByText('ISS Robot 36')).toBeInTheDocument();
      expect(screen.getByText('Colour bars')).toBeInTheDocument();
    });
  });

  it('each card has a download link for the audio', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve(ENTRIES),
    } as Response);

    render(<GalleryPanel />);

    await waitFor(() => {
      const downloadLinks = screen.getAllByRole('link', { name: /download/i });
      expect(downloadLinks).toHaveLength(2);
      expect(downloadLinks[0]).toHaveAttribute('href', 'examples/iss-test.wav');
      expect(downloadLinks[0]).toHaveAttribute('download');
    });
  });

  it('each card has a decoded image', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve(ENTRIES),
    } as Response);

    render(<GalleryPanel />);

    await waitFor(() => {
      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('src', 'gallery/iss-test.png');
      expect(images[1]).toHaveAttribute('src', 'gallery/test-colorbars.png');
    });
  });

  it('calls onTryDecode with the audio URL when Try decoding is clicked', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve(ENTRIES),
    } as Response);

    const onTryDecode = vi.fn();
    render(<GalleryPanel onTryDecode={onTryDecode} />);

    await waitFor(() => screen.getAllByRole('button', { name: /try decoding/i }));

    await userEvent.click(screen.getAllByRole('button', { name: /try decoding/i })[0]);

    expect(onTryDecode).toHaveBeenCalledWith('examples/iss-test.wav');
  });

  it('shows mode badge on each card', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve(ENTRIES),
    } as Response);

    render(<GalleryPanel />);

    await waitFor(() => {
      const badges = screen.getAllByText('Robot 36');
      expect(badges.length).toBeGreaterThanOrEqual(2);
    });
  });
});
