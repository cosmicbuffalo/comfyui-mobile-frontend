import { describe, expect, it } from 'vitest';
import { getQueueCardHeaderGridClass, getQueueCardHeaderLabel } from '../queueCardHeader';

describe('getQueueCardHeaderLabel', () => {
  it('stops showing generating as soon as the card enters the completing handoff', () => {
    expect(getQueueCardHeaderLabel({
      isGenerating: false,
      isCompleting: true,
      isPending: false,
      isStopped: false,
      isErrored: false,
      preferredOutputFilename: 'final.png',
    })).toBe('final.png');
  });

  it('shows loading while a completed card waits for its output filename', () => {
    expect(getQueueCardHeaderLabel({
      isGenerating: false,
      isCompleting: true,
      isPending: false,
      isStopped: false,
      isErrored: false,
      preferredOutputFilename: null,
    })).toBe('LOADING...');
  });

  it('labels interrupted history cards as stopped', () => {
    expect(getQueueCardHeaderLabel({
      isGenerating: false,
      isCompleting: false,
      isPending: false,
      isStopped: true,
      isErrored: false,
      preferredOutputFilename: null,
    })).toBe('STOPPED');
  });

  it('labels errored history cards as error, not stopped', () => {
    expect(getQueueCardHeaderLabel({
      isGenerating: false,
      isCompleting: false,
      isPending: false,
      isStopped: false,
      isErrored: true,
      preferredOutputFilename: null,
    })).toBe('ERROR');
  });

  it('gives completed history cards compact side columns', () => {
    expect(getQueueCardHeaderGridClass(true)).toBe(
      'grid-cols-[2rem_minmax(0,1fr)_2rem]',
    );
    expect(getQueueCardHeaderGridClass(false)).toBe(
      'grid-cols-[minmax(4.5rem,1fr)_minmax(0,12rem)_minmax(4.5rem,1fr)]',
    );
  });
});
