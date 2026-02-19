import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DropZone } from './DropZone.js';

const AudioIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24">
    <title>Audio file</title>
  </svg>
);

describe('DropZone', () => {
  it('renders with basic props', () => {
    render(
      <DropZone
        accept="audio/*"
        onFile={vi.fn()}
        processing={false}
        icon={<AudioIcon />}
        hint="Test hint"
        inputId="test-input"
      />
    );

    expect(screen.getByText('Drag & drop or')).toBeInTheDocument();
    expect(screen.getByText('Choose File')).toBeInTheDocument();
    expect(screen.getByText('Test hint')).toBeInTheDocument();
  });

  it('renders the icon', () => {
    render(
      <DropZone
        accept="audio/*"
        onFile={vi.fn()}
        processing={false}
        icon={<AudioIcon />}
        hint=""
        inputId="test-input"
      />
    );

    expect(screen.getByTitle('Audio file')).toBeInTheDocument();
  });

  it('calls onFile when a file is selected', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();

    render(
      <DropZone
        accept="audio/*"
        onFile={onFile}
        processing={false}
        icon={<AudioIcon />}
        hint=""
        inputId="test-input"
      />
    );

    const file = new File(['content'], 'test.wav', { type: 'audio/wav' });
    const input = document.getElementById('test-input') as HTMLInputElement;

    await user.upload(input, file);

    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('shows processing state', () => {
    render(
      <DropZone
        accept="audio/*"
        onFile={vi.fn()}
        processing={true}
        icon={<AudioIcon />}
        hint=""
        inputId="test-input"
      />
    );

    expect(screen.getByText('Processing…')).toBeInTheDocument();
    expect(screen.queryByText('Choose File')).not.toBeInTheDocument();
  });

  it('handles drag and drop', async () => {
    const onFile = vi.fn();

    render(
      <DropZone
        accept="audio/*"
        onFile={onFile}
        processing={false}
        icon={<AudioIcon />}
        hint=""
        inputId="test-input"
      />
    );

    const section = screen.getByText('Drag & drop or').closest('section');
    const file = new File(['content'], 'test.wav', { type: 'audio/wav' });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const dropEvent = new DragEvent('drop', { dataTransfer, bubbles: true });
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer, writable: false });

    section?.dispatchEvent(dropEvent);

    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('accepts the specified file type', () => {
    render(
      <DropZone
        accept="image/*"
        onFile={vi.fn()}
        processing={false}
        icon={<AudioIcon />}
        hint=""
        inputId="test-input"
      />
    );

    const input = document.getElementById('test-input') as HTMLInputElement;
    expect(input).toHaveAttribute('accept', 'image/*');
  });
});
