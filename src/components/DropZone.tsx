"use client";

import React, { useCallback, useRef, useState } from "react";
import { Upload, File } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropZoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;
}

export default function DropZone({ onFileSelect, accept }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      setSelectedFile(file);
      onFileSelect(file);
    },
    [onFileSelect]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      if (inputRef.current) inputRef.current.value = "";
    },
    [handleFile]
  );

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors",
        dragOver
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--ink-soft)] hover:bg-[var(--bg)]"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onChange}
      />

      {selectedFile ? (
        <div className="flex items-center gap-3">
          <File className="h-6 w-6 text-[var(--accent)]" />
          <div className="text-center">
            <p className="font-medium text-[var(--ink)]">{selectedFile.name}</p>
            <p className="text-sm text-[var(--ink-soft)]">
              {formatBytes(selectedFile.size)}
            </p>
          </div>
        </div>
      ) : (
        <>
          <Upload className="h-8 w-8 text-[var(--ink-soft)]" />
          <div className="text-center">
            <p className="font-medium text-[var(--ink)]">
              Click to browse or drag and drop
            </p>
            <p className="text-sm text-[var(--ink-soft)] mt-1">
              CSV, TSV, JSON, or Excel files
            </p>
          </div>
        </>
      )}
    </div>
  );
}
