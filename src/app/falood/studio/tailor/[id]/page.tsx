"use client";

import React, { useCallback, useState, useRef, useEffect, Suspense } from 'react';
import { ResumeProvider, useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { ResumeForm } from '@/components/falood/resumify/components/form/ResumeForm';
import { ResumePreview } from '@/components/falood/resumify/components/preview/ResumePreview';
import { AiSuggestions } from '@/components/falood/resumify/components/preview/AiSuggestions';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download, FileDown, Palette, Save, Settings, Sparkles, Upload } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { exportResumeAsJSON, importResumeFromJSON } from '@/components/falood/resumify/utils/resumeImportExport';
import { generateResumePdfBlob, resumifyResumeDataToExportDocument, uploadResumeExport } from '@/lib/falood/clientExport';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const TailorContent: React.FC<{ applicationId: string }> = ({ applicationId }) => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const jobTitle = searchParams.get('jobTitle') || 'Untitled Position';
    const company = searchParams.get('company') || '';
    const { state, dispatch } = useResume();
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [toastMsg, setToastMsg] = useState<string | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const [activePanel, setActivePanel] = useState<'form' | 'customize' | 'settings'>('form');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const lastSavedSnapshotRef = useRef<string | null>(null);
    // Synchronous mutual-exclusion for saves, mirroring the base resume
    // builder's persistBaseResume (see src/app/falood/studio/base/[baseResumeId]/page.tsx
    // for the full history: an unguarded PATCH there once let two overlapping
    // saves race and clobber each other, since each PATCH fully overwrites
    // the row and out-of-order responses let an older save win). This save
    // path has the same shape and was missing the same guard. A save this
    // skips is never lost - the debounce effect below re-runs the instant
    // isSaving clears and retries with the freshest state.
    const isSavingRef = useRef(false);
    const pendingSaveRef = useRef(false);
    // Mirrors the fields persistTailoredApplication snapshots, so the
    // unload/unmount safety net below always reads the latest edits without
    // depending on state directly (which would re-attach a global listener
    // on every keystroke).
    const latestStateRef = useRef({ resumeData: state.resumeData, chatHistory: state.chatHistory, jobDescription: state.jobDescription, versions: state.versions });
    useEffect(() => {
        latestStateRef.current = { resumeData: state.resumeData, chatHistory: state.chatHistory, jobDescription: state.jobDescription, versions: state.versions };
    }, [state.resumeData, state.chatHistory, state.jobDescription, state.versions]);
    const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
    const [candidateId, setCandidateId] = useState<string | null>(null);
    const [archiveContext, setArchiveContext] = useState<{ applicationId: string; resumeVersionId: string } | null>(null);

    const showToast = (msg: string) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(null), 3000);
    };

    // Load the saved application and pre-populate the AI with job context
    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch(`/api/falood/applications?id=${applicationId}`);
                const json = await res.json();
                if (json.success && json.data) {
                    dispatch({ type: 'IMPORT_RESUME_DATA', payload: json.data.resumeData });
                    dispatch({ type: 'SET_JOB_DESCRIPTION', payload: json.data.jobDescription || '' });
                    // candidateId may also be embedded in a legacy "meta-candidate"
                    // chatHistory entry (how this was stashed before candidate_id
                    // was a real column) - fall back to that for older sessions.
                    const legacyCandidateId = Array.isArray(json.data.chatHistory)
                        ? json.data.chatHistory.find((m: any) => m?.id === 'meta-candidate')?.candidateId
                        : null;
                    setCandidateId(json.data.candidateId || legacyCandidateId || null);
                    setArchiveContext(json.data.archiveContext || null);

                    // Pre-seed the chat with a system message about the job
                    const systemMsg = {
                        id: 'tailor-context',
                        role: 'assistant' as const,
                        content: `I'm ready to help you tailor this resume for the **${jobTitle}** position${company ? ` at **${company}**` : ''}. I've loaded the job description and your current resume.\n\nPaste any additional details or ask me to optimize specific sections. I'll suggest targeted changes to match this role.`,
                    };
                    const existingHistory = Array.isArray(json.data.chatHistory) ? json.data.chatHistory : [];
                    const hasContextAlready = existingHistory.some((m: any) => m?.id === 'tailor-context');
                    dispatch({ type: 'SET_CHAT_HISTORY', payload: hasContextAlready ? existingHistory : [systemMsg, ...existingHistory] });
                    dispatch({ type: 'SET_VERSIONS', payload: json.data.versions || [] });

                    lastSavedSnapshotRef.current = JSON.stringify({
                        resumeData: json.data.resumeData,
                        chatHistory: hasContextAlready ? existingHistory : [systemMsg, ...existingHistory],
                        jobDescription: json.data.jobDescription || '',
                        versions: json.data.versions || [],
                    });
                    setHasLoadedInitialData(true);
                }
            } catch (error) {
                console.error("Error loading application for tailoring", error);
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, [applicationId, company, jobTitle, dispatch]);

    const persistTailoredApplication = useCallback(async (showSuccessToast = false) => {
        // Never let two PATCHes race - see isSavingRef's declaration for why.
        // The debounce effect below re-checks and retries once this clears,
        // so a save that's skipped here is never silently lost.
        if (isSavingRef.current) {
            pendingSaveRef.current = true;
            return false;
        }

        const latestState = latestStateRef.current;
        const snapshot = JSON.stringify({
            resumeData: latestState.resumeData,
            chatHistory: latestState.chatHistory,
            jobDescription: latestState.jobDescription,
            versions: latestState.versions,
        });

        if (!showSuccessToast && snapshot === lastSavedSnapshotRef.current) {
            return true;
        }

        isSavingRef.current = true;
        setIsSaving(true);
        setSaveStatus('saving');
        try {
            const res = await fetch(`/api/falood/applications?id=${applicationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify({
                    jobDescription: latestState.jobDescription,
                    companyName: company || null,
                    resumeData: latestState.resumeData,
                    chatHistory: latestState.chatHistory,
                }),
            });

            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.success) {
                throw new Error(json?.error || 'Save failed');
            }

            lastSavedSnapshotRef.current = snapshot;
            setSaveStatus('saved');
            if (showSuccessToast) showToast('Tailored resume saved!');
            return true;
        } catch {
            setSaveStatus('error');
            if (showSuccessToast) showToast('Save failed.');
            return false;
        } finally {
            isSavingRef.current = false;
            setIsSaving(false);
            if (pendingSaveRef.current) {
                pendingSaveRef.current = false;
                window.setTimeout(() => void persistTailoredApplication(false), 0);
            }
        }
    }, [applicationId, company]);

    const handleSave = async () => {
        await persistTailoredApplication(true);
    };

    const handleSaveVersion = async () => {
        if (isSavingRef.current) {
            pendingSaveRef.current = true;
            return;
        }
        if (state.versions && state.versions.length > 0) {
            const lastVersion = state.versions[0];
            if (JSON.stringify(lastVersion.resumeData) === JSON.stringify(state.resumeData)) {
                showToast('No changes to save as a new version.');
                return;
            }
        }

        const versionName = `v${(state.versions?.length || 0) + 1} - ${new Date().toLocaleString()}`;
        const newVersion = {
            id: crypto.randomUUID(),
            name: versionName,
            timestamp: new Date().toISOString(),
            resumeData: state.resumeData,
            chatHistory: state.chatHistory,
        };
        const updatedVersions = [newVersion, ...(state.versions || [])];
        dispatch({ type: 'SET_VERSIONS', payload: updatedVersions });
        
        isSavingRef.current = true;
        setIsSaving(true);
        try {
            const saveRes = await fetch(`/api/falood/applications?id=${applicationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify({
                    versions: updatedVersions,
                    resumeData: state.resumeData,
                    chatHistory: state.chatHistory,
                    jobDescription: state.jobDescription,
                    companyName: company || null,
                }),
            });
            const saveJson = await saveRes.json().catch(() => ({}));
            if (!saveRes.ok || !saveJson?.success) throw new Error(saveJson?.error || 'Failed to save version');

            if (archiveContext) {
                const pdfBlob = await generateResumePdfBlob(resumifyResumeDataToExportDocument(state.resumeData));
                await uploadResumeExport({
                    applicationId: archiveContext.applicationId,
                    resumeVersionId: archiveContext.resumeVersionId,
                    exportType: 'pdf',
                    blob: pdfBlob,
                    fileName: `${versionName}.pdf`,
                    archiveLabel: versionName,
                });
                showToast(`Saved version and archived PDF: ${versionName}`);
            } else {
                showToast(`Saved version: ${versionName} (no linked application archive)`);
            }
            lastSavedSnapshotRef.current = JSON.stringify({
                resumeData: state.resumeData,
                chatHistory: state.chatHistory,
                jobDescription: state.jobDescription,
                versions: updatedVersions,
            });
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Failed to save version');
        } finally {
            isSavingRef.current = false;
            setIsSaving(false);
            if (pendingSaveRef.current) {
                pendingSaveRef.current = false;
                window.setTimeout(() => void persistTailoredApplication(false), 0);
            }
        }
    };

    useEffect(() => {
        if (isLoading || !hasLoadedInitialData) return;

        const snapshot = JSON.stringify({
            resumeData: state.resumeData,
            chatHistory: state.chatHistory,
            jobDescription: state.jobDescription,
            versions: state.versions,
        });
        if (snapshot === lastSavedSnapshotRef.current) return;

        const timeoutId = window.setTimeout(() => {
            void persistTailoredApplication(false);
        }, 250);

        return () => window.clearTimeout(timeoutId);
    }, [hasLoadedInitialData, isLoading, isSaving, persistTailoredApplication, state.chatHistory, state.jobDescription, state.resumeData, state.versions]);

    // Autosave is debounced by 1s, and even the explicit Save button's PATCH
    // is a real network round trip - closing the tab or navigating away
    // inside that window has always silently discarded the edit, but that
    // window got much easier to lose the moment the database moved off
    // Neon's fast HTTP driver onto a TCP connection through Hyperdrive (a
    // real per-save round trip instead of a near-instant stateless request) -
    // and this endpoint additionally chains a base-resume sync write server
    // side (see the PATCH handler), making its round trip longer still. This
    // is exactly the "saved with no error, but reopening shows the old
    // content unless I wait a few seconds first" report. `beforeunload`
    // covers a real tab close/refresh; the cleanup below covers a same-tab
    // client-side navigation away from this route, which never fires
    // beforeunload at all. Both flush with `keepalive` - the same guarantee
    // sendBeacon relies on to survive page unload - since sendBeacon itself
    // can only send POST, not PATCH.
    useEffect(() => {
        const isDirty = () => JSON.stringify(latestStateRef.current) !== lastSavedSnapshotRef.current;
        const flushBeacon = () => {
            const { resumeData, chatHistory, jobDescription } = latestStateRef.current;
            fetch(`/api/falood/applications?id=${applicationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobDescription, companyName: company || null, resumeData, chatHistory }),
                keepalive: true,
            }).catch(() => {});
        };
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!isDirty()) return;
            flushBeacon();
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden' && isDirty()) flushBeacon();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (isDirty()) flushBeacon();
        };
    }, [applicationId, company]);

    const handleDownloadPDF = () => window.print();

    const handleExportJSON = () => {
        const success = exportResumeAsJSON(state.resumeData);
        showToast(success ? 'Resume exported as JSON.' : 'Export failed.');
    };

    const handleImportJSON = () => fileInputRef.current?.click();

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const resumeData = await importResumeFromJSON(file);
            dispatch({ type: 'IMPORT_RESUME_DATA', payload: resumeData });
            showToast('Resume imported.');
        } catch {
            showToast('Import failed: invalid file.');
        }

        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    if (isLoading) {
        return <div className="flex items-center justify-center h-[600px]"><p className="muted">Loading resume for tailoring…</p></div>;
    }

    return (
        <div style={{ minHeight: '100vh' }}>
            {/* Toast */}
            {toastMsg && (
                <div style={{
                    position: 'fixed', top: 20, right: 20, zIndex: 9999,
                    padding: '12px 20px', borderRadius: 8,
                    background: 'var(--accent, #2a6f4f)', color: '#fff',
                    fontSize: 13, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                }}>
                    {toastMsg}
                </div>
            )}

            <div className="max-w-[1800px] mx-auto px-4 py-4 print:p-0 print:max-w-none print:w-full">
                {/* Header */}
                <div className="print:hidden" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Link href="/falood" style={{ color: 'inherit' }}>
                            <ArrowLeft size={20} />
                        </Link>
                        <div>
                            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                                Tailoring: {jobTitle}
                                {company && <span className="muted" style={{ fontWeight: 400 }}> at {company}</span>}
                            </h1>
                            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                                AI will suggest changes to match this job. Accept or reject each suggestion.
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                            size="sm"
                            variant={showEditor ? "default" : "outline"}
                            onClick={() => setShowEditor((v) => !v)}
                            className="flex items-center gap-2"
                        >
                            <Sparkles className="w-4 h-4" />
                            {showEditor ? 'Hide Tools' : 'Show Tools'}
                        </Button>
                        {state.versions && state.versions.length > 0 && (
                            <Select onValueChange={(id) => {
                                const v = state.versions.find(v => v.id === id);
                                if (v) {
                                    dispatch({ type: 'RESTORE_VERSION', payload: v });
                                    showToast(`Restored ${v.name}`);
                                }
                            }}>
                                <SelectTrigger className="w-[180px] h-8 text-xs">
                                    <SelectValue placeholder="Restore Version" />
                                </SelectTrigger>
                                <SelectContent>
                                    {state.versions.map(v => (
                                        <SelectItem key={v.id} value={v.id} className="text-xs">
                                            {v.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <Button size="sm" variant="outline" onClick={handleSaveVersion} disabled={isSaving} className="flex items-center gap-2">
                            Save as Version
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleSave} disabled={isSaving} className="flex items-center gap-2">
                            <Save className="w-4 h-4" />{isSaving ? 'Saving…' : 'Save'}
                        </Button>
                        <Button size="sm" variant="default" onClick={handleDownloadPDF} className="flex items-center gap-2">
                            <Download className="w-4 h-4" />PDF
                        </Button>
                    </div>
                </div>

                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" style={{ display: 'none' }} />

                <div className="flex flex-col xl:flex-row gap-4 xl:overflow-x-auto print:overflow-visible print:block print:gap-0">
                    {showEditor && (
                        <div className={cn(
                            "w-full xl:w-[520px] bg-white dark:bg-[var(--card)] rounded-xl shadow-lg overflow-hidden flex flex-col print:hidden",
                            "xl:flex"
                        )} style={{ height: 780, flexShrink: 0 }}>
                            <div style={{ borderBottom: '1px solid var(--border, #e5e7eb)', flexShrink: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', gap: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <Button
                                            variant={activePanel === 'form' ? 'default' : 'ghost'}
                                            size="sm"
                                            onClick={() => setActivePanel('form')}
                                            style={{ borderRadius: 8 }}
                                        >
                                            Content
                                        </Button>
                                        <Button
                                            variant={activePanel === 'customize' ? 'default' : 'ghost'}
                                            size="sm"
                                            onClick={() => setActivePanel('customize')}
                                            style={{ borderRadius: 8 }}
                                        >
                                            <Palette className="w-4 h-4 mr-2" />
                                            Customize
                                        </Button>
                                        <Button
                                            variant={activePanel === 'settings' ? 'default' : 'ghost'}
                                            size="sm"
                                            onClick={() => setActivePanel('settings')}
                                            style={{ borderRadius: 8 }}
                                        >
                                            <Settings className="w-4 h-4 mr-2" />
                                            Settings
                                        </Button>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Button size="sm" variant="outline" onClick={handleImportJSON} className="flex items-center gap-2 px-3 py-2">
                                            <Upload className="w-4 h-4" />
                                            Import
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={handleExportJSON} className="flex items-center gap-2 px-3 py-2">
                                            <FileDown className="w-4 h-4" />
                                            Export
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                <ResumeForm activePanel={activePanel} />
                            </div>
                        </div>
                    )}

                    {/* Resume Preview */}
                    <div className="flex-1 bg-white dark:bg-[var(--card)] rounded-xl shadow-lg overflow-hidden flex flex-col print:w-full print:shadow-none print:rounded-none print:block print:overflow-visible h-[780px] min-w-[620px] shrink-0 print:h-auto print:min-w-0">
                        <div
                            id="resume-print-area"
                            data-page-format={state.resumeData.pageFormat}
                            style={{ flex: 1, overflow: 'hidden', background: 'var(--bg-secondary, #f9fafb)' }}
                            className="print:overflow-visible print:bg-white"
                        >
                            <ResumePreview />
                        </div>
                    </div>

                    {/* AI Suggestions Panel */}
                    <div className="w-full lg:w-[480px] bg-white dark:bg-[var(--card)] rounded-xl shadow-lg overflow-hidden flex flex-col print:hidden" style={{ height: 780, flexShrink: 0 }}>
                        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #e5e7eb)', flexShrink: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Sparkles size={16} style={{ color: 'var(--accent)' }} />
                                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>AI Tailoring Copilot</h2>
                            </div>
                            <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
                                Ask AI to optimize bullets, skills, or summary for this specific role.
                            </p>
                        </div>
                        <div style={{ flex: 1, overflow: 'hidden', padding: 8 }}>
                            <AiSuggestions candidateId={candidateId} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function FaloodTailorPage() {
    const params = useParams<{ id: string }>();
    const applicationId = params?.id || '';

    return (
        <ResumeProvider>
            <Suspense fallback={<div className="flex items-center justify-center h-screen"><p>Loading…</p></div>}>
                <TailorContent applicationId={applicationId} />
            </Suspense>
        </ResumeProvider>
    );
}
