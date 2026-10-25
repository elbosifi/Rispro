import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClinicalEditor } from './clinical-editor';
import { LanguageProvider } from '@/providers/language-provider-component';
import type { Episode } from './api';

const mocked = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock('./api', () => ({ action: mocked.action }));
const episode: Episode = { id: 1, patientId: 2, diagnosis: 'Synthetic', diagnosisCategory: 'Other', status: 'clinical_review', active: true, revision: 1, data: {}, patientName: 'Synthetic patient', mrn: 'GK1', updatedAt: '', qrActive: false };
beforeEach(() => { localStorage.setItem('rispro-language', 'en'); vi.useFakeTimers(); mocked.action.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function editor() { return render(<LanguageProvider><ClinicalEditor episode={episode} enabled diagnosisDetails={false} onSaved={vi.fn()} onDirty={vi.fn()} /></LanguageProvider>); }
it('retains edits made during an in-flight autosave and saves them with the returned revision', async () => {
  let resolveSave!: (value: { episode: Episode }) => void;
  mocked.action.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; })).mockResolvedValueOnce({ episode: { ...episode, revision: 3 } });
  editor(); fireEvent.change(screen.getByLabelText('History'), { target: { value: 'First edit' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(950); });
  expect(mocked.action).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('History'), { target: { value: 'Newer edit while saving' } });
  await act(async () => { resolveSave({ episode: { ...episode, revision: 2 } }); });
  expect((screen.getByLabelText('History') as HTMLTextAreaElement).value).toBe('Newer edit while saving');
  await act(async () => { await vi.advanceTimersByTimeAsync(950); });
  expect(mocked.action).toHaveBeenCalledTimes(2);
  expect(mocked.action.mock.calls[1][0].revision).toBe(2);
  expect(mocked.action.mock.calls[1][2].clinical.history).toBe('Newer edit while saving');
});
it('stops autosaving on a version conflict and preserves the local text for review', async () => {
  mocked.action.mockRejectedValue(new Error('Episode changed. Reload and review before saving.'));
  editor(); fireEvent.change(screen.getByLabelText('History'), { target: { value: 'Unsaved local text' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(950); });
  expect(screen.getByRole('alert').textContent).toContain('Episode changed');
  expect((screen.getByLabelText('History') as HTMLTextAreaElement).value).toBe('Unsaved local text');
  fireEvent.change(screen.getByLabelText('History'), { target: { value: 'Keep my text' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(mocked.action).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: /Reload latest/ })).toBeTruthy();
});
it('keeps the saved revision while the parent is still refetching', async () => {
  mocked.action.mockResolvedValueOnce({ episode: { ...episode, revision: 2 } }).mockResolvedValueOnce({ episode: { ...episode, revision: 3 } });
  editor();
  fireEvent.change(screen.getByLabelText('History'), { target: { value: 'Saved edit' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(950); });
  fireEvent.change(screen.getByLabelText('History'), { target: { value: 'Next edit before refetch finishes' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(950); });
  expect(mocked.action.mock.calls[1][0].revision).toBe(2);
});
it('refreshes an untouched draft from the latest server version', () => {
  const initial = { ...episode, data: { clinical: { history: 'Old server history', examination: '', imaging: '', assessment: '', priorTreatment: '', diagnosisDetails: '', priorTreatmentUnavailable: false } } };
  const renderEditor = (value: Episode) => <LanguageProvider><ClinicalEditor episode={value} enabled diagnosisDetails={false} onSaved={vi.fn()} onDirty={vi.fn()} /></LanguageProvider>;
  const view = render(renderEditor(initial));
  view.rerender(renderEditor({ ...initial, revision: 2, data: { clinical: { ...initial.data.clinical, history: 'New colleague history' } } }));
  expect((screen.getByLabelText('History') as HTMLTextAreaElement).value).toBe('New colleague history');
});
