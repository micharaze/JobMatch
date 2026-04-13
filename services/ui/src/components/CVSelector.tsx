import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, FileCheck, Loader2, AlertCircle, Check, Trash2 } from 'lucide-react';
import { cvApi } from '../api/cv';
import type { CvMeta } from '../types';

interface Props {
  selectedCvId: string | null;
  onSelect: (cvId: string) => void;
  onDeselect: () => void;
}

export function CVSelector({ selectedCvId, onSelect, onDeselect }: Props) {
  const [tab, setTab] = useState<'upload' | 'existing'>('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: cvs = [] } = useQuery({
    queryKey: ['cvs'],
    queryFn: () => cvApi.list(),
    refetchInterval: (query) => {
      const hasPending = (query.state.data as CvMeta[] | undefined)?.some(
        (cv) => cv.normalization_status === 'pending' || cv.normalization_status === 'processing',
      );
      return hasPending ? 3000 : false;
    },
  });

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const result = await cvApi.upload(file);
      await queryClient.invalidateQueries({ queryKey: ['cvs'] });
      onSelect(result.cv_id);
      setTab('existing');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      // Reset input so the same file can be re-selected
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleDelete(cv: CvMeta) {
    setDeletingId(cv.id);
    try {
      await cvApi.delete(cv.id);
      await queryClient.invalidateQueries({ queryKey: ['cvs'] });
      if (cv.id === selectedCvId) onDeselect();
    } catch { /* ignore — button just re-enables */ }
    finally { setDeletingId(null); }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  const normStatus = (cv: CvMeta) => cv.normalization_status ?? cv.extraction_status;
  const isReady = (cv: CvMeta) => normStatus(cv) === 'done';

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
      <h2 className="mb-3 text-sm font-medium text-slate-300">1. Select CV</h2>

      <div className="mb-4 flex gap-1">
        {(['upload', 'existing'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              tab === t
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {t === 'upload' ? 'Upload New' : `Select Existing (${cvs.length})`}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <div>
          {/* label htmlFor is the reliable way to activate file inputs across all browsers */}
          <label
            htmlFor="cv-file-input"
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
              dragging
                ? 'border-indigo-500 bg-indigo-950/30'
                : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/30'
            }`}
          >
            {uploading ? (
              <Loader2 className="mb-2 h-8 w-8 animate-spin text-indigo-400" />
            ) : (
              <Upload className="mb-2 h-8 w-8 text-slate-500" />
            )}
            <p className="text-sm text-slate-400">
              {uploading ? 'Uploading…' : 'Drop PDF, DOCX, or TXT here'}
            </p>
            <p className="mt-1 text-xs text-slate-600">or click to browse</p>
          </label>
          <input
            id="cv-file-input"
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
          />
          {uploadError && (
            <p className="mt-2 flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="h-3 w-3" /> {uploadError}
            </p>
          )}
        </div>
      )}

      {tab === 'existing' && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {cvs.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">No CVs uploaded yet</p>
          )}
          {cvs.map((cv) => {
            const ready = isReady(cv);
            const isSelected = cv.id === selectedCvId;
            const isDeleting = deletingId === cv.id;
            return (
              <div
                key={cv.id}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 transition-colors ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-950/40'
                    : ready
                      ? 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50'
                      : 'border-slate-800'
                }`}
              >
                {/* Selection area */}
                <button
                  onClick={() => ready && onSelect(cv.id)}
                  disabled={!ready}
                  className={`flex flex-1 items-center gap-2 min-w-0 text-left text-sm ${
                    isSelected ? 'text-white' : ready ? 'text-slate-300' : 'text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <FileCheck className={`h-4 w-4 shrink-0 ${ready ? 'text-emerald-400' : 'text-slate-600'}`} />
                  <span className="truncate">{cv.original_name}</span>
                  {!ready && (
                    <span className="ml-auto text-xs text-amber-500 shrink-0">
                      {normStatus(cv) === 'processing' ? 'normalizing…' : 'pending'}
                    </span>
                  )}
                  {isSelected && <Check className="ml-auto h-4 w-4 text-indigo-400 shrink-0" />}
                </button>

                {/* Delete button */}
                <button
                  onClick={() => void handleDelete(cv)}
                  disabled={isDeleting}
                  className="shrink-0 rounded p-1 text-slate-600 hover:text-red-400 hover:bg-red-950/30 transition-colors disabled:opacity-40"
                  title="Delete CV"
                >
                  {isDeleting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selectedCvId && (
        <p className="mt-3 text-xs text-emerald-400 flex items-center gap-1">
          <Check className="h-3 w-3" />
          CV selected
        </p>
      )}
    </div>
  );
}
