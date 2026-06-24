"use client";

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { ResumeProvider, useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { ResumeForm } from '@/components/falood/resumify/components/form/ResumeForm';
import { ResumePreview } from '@/components/falood/resumify/components/preview/ResumePreview';
import { AiSuggestions } from '@/components/falood/resumify/components/preview/AiSuggestions';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download, FileDown, Palette, Save, Settings, Sparkles, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { exportResumeAsJSON, importResumeFromJSON } from '@/components/falood/resumify/utils/resumeImportExport';
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
    const [toastMsg, setToastMsg] = useState<string | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const [activePanel, setActivePanel] = useState<'form' | 'customize' | 'settings'>('form');
    const fileInputRef = useRef<HTMLInputElement>(null);

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

                    // Pre-seed the chat with a system message about the job
                    const systemMsg = {
                        id: 'tailor-context',
                        role: 'assistant' as const,
                        content: `I'm ready to help you tailor this resume for the **${jobTitle}** position${company ? ` at **${company}**` : ''}. I've loaded the job description and your current resume.\n\nPaste any additional details or ask me to optimize specific sections. I'll suggest targeted changes to match this role.`,
                    };
                    const existingHistory = Array.isArray(json.data.chatHistory) ? json.data.chatHistory : [];
                    const hasContextAlready = existingHistory.some((m: any) => m?.id === 'tailor-context');
                    dispatch({ type: 'SET_CHAT_HISTORY', payload: hasContextAlready ? existingHistory : [systemMsg, ...existingHistory] });
                }
            } catch (error) {
                console.error("Error loading application for tailoring", error);
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, [applicationId, company, jobTitle, dispatch]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const res = await fetch('/api/falood/applications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobDescription: state.jobDescription,
                    companyName: company || null,
                    skills: [],
                    resumeData: state.resumeData,
                    chatHistory: state.chatHistory,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.success) {
                throw new Error(json?.error || 'Save failed');
            }

            const newId = json?.data?.id as string | undefined;
            showToast('Tailored resume saved!');

            if (newId && newId !== applicationId) {
                const nextUrl = `/falood/studio/tailor/${encodeURIComponent(newId)}?jobTitle=${encodeURIComponent(jobTitle)}&company=${encodeURIComponent(company)}`;
                router.push(nextUrl);
            }
        } catch {
            showToast('Save failed.');
        } finally {
            setIsSaving(false);
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

            <div style={{ maxWidth: 1800, margin: '0 auto', padding: '16px 16px' }}>
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
                        <Button size="sm" variant="outline" onClick={handleSave} disabled={isSaving} className="flex items-center gap-2">
                            <Save className="w-4 h-4" />{isSaving ? 'Saving…' : 'Save'}
                        </Button>
                        <Button size="sm" variant="default" onClick={handleDownloadPDF} className="flex items-center gap-2">
                            <Download className="w-4 h-4" />PDF
                        </Button>
                    </div>
                </div>

                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" style={{ display: 'none' }} />

                <div className="flex flex-col xl:flex-row gap-4">
                    {showEditor && (
                        <div className={cn(
                            "w-full xl:w-[520px] bg-white dark:bg-[var(--card)] rounded-xl shadow-lg overflow-hidden flex flex-col print:hidden",
                            "xl:flex"
                        )} style={{ height: 780 }}>
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
                    <div className="flex-1 bg-white dark:bg-[var(--card)] rounded-xl shadow-lg overflow-hidden flex flex-col print:w-full print:shadow-none print:rounded-none print:block print:overflow-visible" style={{ height: 780 }}>
                        <div id="resume-print-area" style={{ flex: 1, overflow: 'hidden', background: 'var(--bg-secondary, #f9fafb)' }}>
                            <ResumePreview />
                        </div>
                    </div>

                    {/* AI Suggestions Panel */}
                    <div className="w-full lg:w-[440px] bg-white dark:bg-[var(--card)] rounded-xl shadow-lg overflow-hidden flex flex-col print:hidden" style={{ height: 780 }}>
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
                            <AiSuggestions />
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
