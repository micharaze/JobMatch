import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, FileCheck, Loader2, AlertCircle, Check } from 'lucide-react';
import { cvApi } from '../api/cv';
import type { CvMeta } from '../types';

interface Props {
  selectedCvId: string | null;
  onSelect: (cvId: string) => void;
}

export function CVSelector({ selectedCvId, onSelect }: Props) {
  const [tab, setTab] = useState<'upload' | 'existing'>('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
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
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
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
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
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
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={onFileInput}
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
            return (
              <button
                key={cv.id}
                onClick={() => ready && onSelect(cv.id)}
                disabled={!ready}
                className={`w-full flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-950/40 text-white'
                    : ready
                      ? 'border-slate-700 hover:border-slate-500 text-slate-300 hover:bg-slate-800/50'
                      : 'border-slate-800 text-slate-600 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileCheck className={`h-4 w-4 shrink-0 ${ready ? 'text-emerald-400' : 'text-slate-600'}`} />
                  <span className="truncate">{cv.original_name}</span>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  {!ready && (
                    <span className="text-xs text-amber-500">
                      {normStatus(cv) === 'processing' ? 'normalizing…' : 'pending'}
                    </span>
                  )}
                  {isSelected && <Check className="h-4 w-4 text-indigo-400" />}
                </div>
              </button>
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
