"use client";

import React, { useCallback, useState, useRef, useEffect, Suspense } from 'react';
import { ResumeProvider, useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { ResumeForm } from '@/components/falood/resumify/components/form/ResumeForm';
import { ResumePreview } from '@/components/falood/resumify/components/preview/ResumePreview';
import { AiSuggestions } from '@/components/falood/resumify/components/preview/AiSuggestions';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowLeft, Download, FileDown, Palette, Save, Settings, Sparkles, Upload } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { exportResumeAsJSON, importResumeFromJSON } from '@/components/falood/resumify/utils/resumeImportExport';
import { generateResumePdfBlob, resumifyResumeDataToExportDocument, uploadResumeExport } from '@/lib/falood/clientExport';
import { isResumeDataEffectivelyEmpty } from '@/lib/falood/resumeEmptyCheck';
import { useStudioPersistence } from '@/components/falood/resumify/hooks/useStudioPersistence';
import type { ResumeData } from '@/components/falood/resumify/types/resume';
import type { ResumeVersion } from '@/components/falood/resumify/contexts/ResumeContext';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface TailorSnapshot {
    resumeData: ResumeData;
    chatHistory: any[];
    jobDescription: string;
    versions: ResumeVersion[];
}

const TailorContent: React.FC<{ applicationId: string }> = ({ applicationId }) => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const jobTitle = searchParams.get('jobTitle') || 'Untitled Position';
    const company = searchParams.get('company') || '';
    const { state, dispatch } = useResume();
    const [isLoading, setIsLoading] = useState(true);
    const [isSavingVersion, setIsSavingVersion] = useState(false);
    const [toastMsg, setToastMsg] = useState<string | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const [activePanel, setActivePanel] = useState<'form' | 'customize' | 'settings'>('form');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [candidateId, setCandidateId] = useState<string | null>(null);
    const [archiveContext, setArchiveContext] = useState<{ applicationId: string; resumeVersionId: string } | null>(null);

    const showToast = (msg: string) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(null), 3000);
    };

    const studio = useStudioPersistence<TailorSnapshot>({
        enabled: true,
        snapshot: { resumeData: state.resumeData, chatHistory: state.chatHistory, jobDescription: state.jobDescription, versions: state.versions },
        getResumeData: (snapshot) => snapshot.resumeData,
        save: async (snapshot) => {
            const res = await fetch(`/api/falood/applications?id=${applicationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobDescription: snapshot.jobDescription,
                    companyName: company || null,
                    resumeData: snapshot.resumeData,
                    chatHistory: snapshot.chatHistory,
                }),
            });
            const json = await res.json().catch(() => ({}));
            return res.ok && !!json?.success;
        },
        flush: (snapshot) => {
            const body = JSON.stringify({
                jobDescription: snapshot.jobDescription,
                companyName: company || null,
                resumeData: snapshot.resumeData,
                chatHistory: snapshot.chatHistory,
            });
            // Browsers cap in-flight keepalive bodies at 64KB total and reject
            // anything over it outright. Use keepalive only when it fits;
            // otherwise a plain fetch (still completes on in-app navigation,
            // and beforeunload's own confirm prompt covers a real close/refresh).
            fetch(`/api/falood/applications?id=${applicationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body,
                keepalive: new Blob([body]).size < 60_000,
            }).catch(() => {});
        },
    });

    // Load the saved application and pre-populate the AI with job context.
    // `load` is a useCallback (not a plain function inside the effect) so
    // the error screen's Retry button can call the exact same path.
    const load = useCallback(async () => {
                setIsLoading(true);
                setLoadError(null);
            try {
                const res = await fetch(`/api/falood/applications?id=${applicationId}`);
                const json = await res.json();
                if (!res.ok || !json.success || !json.data) {
                    throw new Error(json?.error || 'This resume could not be found.');
                }
                // A response that parses but carries no real resume content
                // (null/undefined/wrong type) must never be treated as "the
                // resume is legitimately blank" - that's indistinguishable
                // from the load having actually failed, and importing it
                // would silently arm every save path with the placeholder
                // content. Fail loudly instead; the error screen below is
                // the only safe thing to show here.
                if (json.data.resumeData === null || json.data.resumeData === undefined || typeof json.data.resumeData !== 'object') {
                    throw new Error('The server returned no resume content for this session.');
                }
                {
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
                    const seededHistory = hasContextAlready ? existingHistory : [systemMsg, ...existingHistory];
                    dispatch({ type: 'SET_CHAT_HISTORY', payload: seededHistory });
                    const loadedVersions = json.data.versions || [];
                    dispatch({ type: 'SET_VERSIONS', payload: loadedVersions });

                    studio.markLoaded({
                        resumeData: json.data.resumeData,
                        chatHistory: seededHistory,
                        jobDescription: json.data.jobDescription || '',
                        versions: loadedVersions,
                    });
                }
            } catch (error) {
                console.error("Error loading application for tailoring", error);
                // Never fall through to the normal editable UI on a failed
                // load - that UI starts from the blank placeholder resume,
                // and every save path (autosave, explicit Save, exit-flush)
                // would then be one navigation-away or button-click from
                // persisting that placeholder over whatever's really saved.
                // Showing a dedicated error screen instead (below) makes
                // that impossible: there is no editable resume on screen to
                // accidentally save until a load has genuinely succeeded.
                setLoadError(error instanceof Error ? error.message : 'Failed to load this resume.');
            } finally {
                setIsLoading(false);
            }
    }, [applicationId, company, jobTitle, dispatch, studio]);

    useEffect(() => {
        void load();
        // Intentionally run only on mount/applicationId change, not on every
        // `load` identity change (load's own deps include jobTitle/company,
        // which come from the URL and don't need a fresh fetch on their own).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applicationId]);

    const handleSave = async () => {
        const ok = await studio.persist();
        if (ok) {
            showToast('Tailored resume saved!');
        } else if (studio.lastBlockReason === 'not_loaded') {
            showToast('Still loading this resume - please wait a moment and try again.');
        } else if (studio.lastBlockReason === 'would_erase_content') {
            showToast('Refusing to save: resume appears empty. Reload the page before trying again.');
        } else {
            showToast('Save failed.');
        }
    };

    const handleSaveVersion = async () => {
        // Same guard shouldPersistResumeSnapshot encodes for the shared
        // studio hook, applied directly here since this is its own
        // independent PATCH (including overwriting `versions`, which the
        // hook's regular save/flush deliberately never sends - see the save/
        // flush functions above) and so needs its own check rather than
        // relying on the hook's guard, which only wraps its own persist().
        if (!studio.hasLoadedInitialData) {
            showToast('Still loading this resume - please wait a moment and try again.');
            return;
        }
        if (isResumeDataEffectivelyEmpty(state.resumeData)) {
            showToast('Refusing to save: resume appears empty. Reload the page before trying again.');
            return;
        }
        if (studio.isSaving || isSavingVersion) return;
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

        setIsSavingVersion(true);
        try {
            const saveRes = await fetch(`/api/falood/applications?id=${applicationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
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
            // Fast-forward the shared hook's notion of "last known saved
            // snapshot" to include the versions this just persisted out of
            // band, so the regular autosave/exit-flush paths don't treat the
            // version bump alone as still-dirty content to re-send.
            studio.markLoaded({
                resumeData: state.resumeData,
                chatHistory: state.chatHistory,
                jobDescription: state.jobDescription,
                versions: updatedVersions,
            });
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Failed to save version');
        } finally {
            setIsSavingVersion(false);
        }
    };

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

    // Never render the editable form/preview on a failed load - that UI
    // starts from the blank placeholder resume, and every save path on this
    // page would then be one click or one tab-switch away from persisting
    // that placeholder over whatever's actually saved.
    if (loadError) {
        return (
            <div className="flex flex-col items-center justify-center h-[600px] gap-4 text-center px-4">
                <AlertTriangle className="w-10 h-10 text-amber-500" />
                <div>
                    <h2 className="text-lg font-semibold mb-1">Couldn&apos;t load this resume</h2>
                    <p className="muted text-sm max-w-md">{loadError}</p>
                    <p className="muted text-xs mt-2">Nothing was changed - it&apos;s safe to retry.</p>
                </div>
                <div className="flex gap-2">
                    <Button size="sm" onClick={() => void load()}>Retry</Button>
                    <Link href="/falood"><Button size="sm" variant="outline">Back to Falood</Button></Link>
                </div>
            </div>
        );
    }

    const isSaving = studio.isSaving || isSavingVersion;

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
                        <Button size="sm" variant="outline" onClick={handleSave} className="flex items-center gap-2">
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
