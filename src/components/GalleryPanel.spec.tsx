import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GalleryEntry } from '../types.js';
import { GalleryPanel } from './GalleryPanel.js';

const ENTRIES: GalleryEntry[] = [
  {
    name: 'EasyPal Sample 1',
    audioFile: 'examples/sample1.wav',
    imageFile: 'gallery/sample1.png',
    mode: 'EasyPal',
    quality: 'good',
  },
  {
    name: 'EasyPal Sample 2',
    audioFile: 'examples/sample2.wav',
    imageFile: 'gallery/sample2.png',
    mode: 'EasyPal',
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
      expect(screen.getByText('EasyPal Sample 1')).toBeInTheDocument();
      expect(screen.getByText('EasyPal Sample 2')).toBeInTheDocument();
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
      expect(downloadLinks[0]).toHaveAttribute('href', 'examples/sample1.wav');
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
      expect(images[0]).toHaveAttribute('src', 'gallery/sample1.png');
      expect(images[1]).toHaveAttribute('src', 'gallery/sample2.png');
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

    expect(onTryDecode).toHaveBeenCalledWith('examples/sample1.wav');
  });

  it('shows mode badge on each card', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve(ENTRIES),
    } as Response);

    render(<GalleryPanel />);

    await waitFor(() => {
      const badges = screen.getAllByText('EasyPal');
      expect(badges.length).toBeGreaterThanOrEqual(2);
    });
  });
});
