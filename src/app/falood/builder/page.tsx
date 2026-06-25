"use client";

import React, { useState, useRef, Suspense, useEffect } from 'react';
import { ResumeProvider, useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { ResumeForm } from '@/components/falood/resumify/components/form/ResumeForm';
import { ResumePreview } from '@/components/falood/resumify/components/preview/ResumePreview';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, Eye, EyeOff, Palette, Settings, AlertTriangle, Upload, FileDown, Sparkles, Save, ArrowLeft } from 'lucide-react';
import { AiSuggestions } from '@/components/falood/resumify/components/preview/AiSuggestions';
import { cn } from '@/lib/utils';
import { exportResumeAsJSON, importResumeFromJSON } from '@/components/falood/resumify/utils/resumeImportExport';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const ResumeContent: React.FC = () => {
    const [showPreview, setShowPreview] = useState(true);
    const [showAiPanel, setShowAiPanel] = useState(true);
    const [activePanel, setActivePanel] = useState<'form' | 'customize' | 'settings'>('form');
    const [pageOverflow, setPageOverflow] = useState(false);
    const { state, exportResumeData, importResumeData, setChatHistory, setJobDescription } = useResume();
    const resumeRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const searchParams = useSearchParams();
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [toastMsg, setToastMsg] = useState<string | null>(null);

    // Show a simple inline toast since we don't have shadcn toast wired into TalentOS layout
    const showToast = (msg: string) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(null), 3000);
    };

    useEffect(() => {
        const id = searchParams.get('id');
        if (id) {
            const fetchApplication = async () => {
                setIsLoading(true);
                try {
                    const response = await fetch(`/api/falood/applications?id=${id}`);
                    const json = await response.json();
                    if (json.success && json.data) {
                        importResumeData(json.data.resumeData);
                        setChatHistory(json.data.chatHistory || []);
                        setJobDescription(json.data.jobDescription || '');
                        showToast('Application loaded from dashboard.');
                    }
                } catch (error) {
                    console.error("Error fetching application", error);
                } finally {
                    setIsLoading(false);
                }
            };
            fetchApplication();
        }
    }, [searchParams]);

    React.useEffect(() => {
        const checkOverflow = () => {
            const element = document.getElementById('resume-content');
            if (element) {
                const pageHeight = state.resumeData.pageFormat === 'a4' ? 297 * 3.779 : 11 * 96;
                const isOverflowing = element.scrollHeight > pageHeight * 1.1;
                setPageOverflow(isOverflowing);
            }
        };

        const timeoutId = setTimeout(checkOverflow, 500);
        return () => clearTimeout(timeoutId);
    }, [state.resumeData, state.resumeData.pageFormat]);

    const handleDownloadPDF = () => {
        window.print();
    };

    const handleExportJSON = () => {
        const success = exportResumeAsJSON(exportResumeData());
        if (success) {
            showToast('Resume exported as JSON.');
        } else {
            showToast('Export failed.');
        }
    };

    const handleSaveToDashboard = async () => {
        setIsSaving(true);
        try {
            let extractedSkills: string[] = [];
            let extractedCompany: string | null = null;
            if (state.jobDescription) {
                try {
                    const skillsResponse = await fetch('/api/falood/extract-skills', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jobDescription: state.jobDescription }),
                    });
                    if (skillsResponse.ok) {
                        const skillsData = await skillsResponse.json();
                        extractedSkills = skillsData.skills || [];
                        extractedCompany = skillsData.companyName || null;
                    }
                } catch (err) {
                    console.error("Failed to extract skills", err);
                }
            }

            const saveResponse = await fetch('/api/falood/applications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobDescription: state.jobDescription,
                    companyName: extractedCompany,
                    skills: extractedSkills,
                    resumeData: state.resumeData,
                    chatHistory: state.chatHistory,
                }),
            });

            if (saveResponse.ok) {
                showToast('Saved to dashboard!');
            } else {
                throw new Error("Failed to save application");
            }
        } catch (error) {
            console.error('Error saving:', error);
            showToast('Save failed.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleImportJSON = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const resumeData = await importResumeFromJSON(file);
            importResumeData(resumeData);
            showToast('Resume imported successfully.');
        } catch (error) {
            showToast('Import failed: invalid file.');
        }

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-[600px]">
                <p className="muted">Loading application…</p>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh' }}>
            {/* Toast notification */}
            {toastMsg && (
                <div style={{
                    position: 'fixed', top: 20, right: 20, zIndex: 9999,
                    padding: '12px 20px', borderRadius: 8,
                    background: 'var(--accent, #3b82f6)', color: '#fff',
                    fontSize: 13, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    animation: 'fadeIn 0.2s ease'
                }}>
                    {toastMsg}
                </div>
            )}

            <div style={{ maxWidth: 1800, margin: '0 auto', padding: '16px 16px' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Link href="/falood" style={{ color: 'inherit' }}>
                            <ArrowLeft size={20} />
                        </Link>
                        <div>
                            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Falood Resume Builder</h1>
                            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Create & customize your resume with AI assistance</p>
                        </div>
                    </div>
                    <div className="print:hidden" style={{ display: 'flex', gap: 8 }}>
                        <Button
                            variant={showAiPanel ? "default" : "outline"}
                            size="sm"
                            onClick={() => setShowAiPanel(!showAiPanel)}
                            className="hidden xl:flex items-center gap-2"
                        >
                            <Sparkles className="w-4 h-4" />
                            {showAiPanel ? 'Hide AI' : 'Show AI'}
                        </Button>
                    </div>
                </div>

                {/* Page overflow warning */}
                {pageOverflow && (
                    <Alert className="mb-4 print:hidden" style={{ borderColor: '#f59e0b', background: 'rgba(245,158,11,0.1)' }}>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                            Your resume content exceeds one page. Consider removing some content or using a more compact template.
                        </AlertDescription>
                    </Alert>
                )}

                {/* Mobile toggle */}
                <div className="lg:hidden mb-4 flex gap-2 print:hidden">
                    <Button
                        variant={showPreview ? "default" : "outline"}
                        size="sm"
                        onClick={() => setShowPreview(!showPreview)}
                        className="flex items-center gap-2"
                    >
                        {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        {showPreview ? 'Hide Preview' : 'Show Preview'}
                    </Button>
                </div>

                <div className="flex flex-col xl:flex-row gap-4" style={{ maxWidth: 1800, margin: '0 auto' }}>
                    {/* Form Panel */}
                    <div className={cn(
                        "w-full lg:w-[600px] xl:w-[500px] bg-white dark:bg-[var(--card)] rounded-xl shadow-lg overflow-hidden flex flex-col print:hidden",
                        "lg:block",
                        showPreview ? "hidden lg:flex" : "flex"
                    )} style={{ height: 750 }}>
                        <div style={{ borderBottom: '1px solid var(--border, #e5e7eb)', flexShrink: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <Button
                                    variant={activePanel === 'form' ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => setActivePanel('form')}
                                    style={{ borderRadius: 0, padding: '12px 24px' }}
                                >
                                    Content
                                </Button>
                                <Button
                                    variant={activePanel === 'customize' ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => setActivePanel('customize')}
                                    style={{ borderRadius: 0, padding: '12px 24px' }}
                                >
                                    <Palette className="w-4 h-4 mr-2" />
                                    Customize
                                </Button>
                                <Button
                                    variant={activePanel === 'settings' ? 'default' : 'ghost'}
                                    size="sm"
                                    onClick={() => setActivePanel('settings')}
                                    style={{ borderRadius: 0, padding: '12px 24px' }}
                                >
                                    <Settings className="w-4 h-4 mr-2" />
                                    Settings
                                </Button>
                            </div>
                        </div>

                        <div style={{ flex: 1, overflow: 'hidden' }}>
                            <ResumeForm activePanel={activePanel} />
                        </div>
                    </div>

                    {/* Preview Panel */}
                    <div className={cn(
                        "w-full lg:w-auto xl:flex-1 bg-white dark:bg-[var(--card)] rounded-xl shadow-lg overflow-hidden flex flex-col print:w-full print:h-auto print:shadow-none print:rounded-none print:block print:overflow-visible",
                        "lg:flex",
                        showPreview ? "flex" : "hidden lg:flex"
                    )} style={{ height: 750 }}>
                        <div className="print:hidden" style={{ borderBottom: '1px solid var(--border, #e5e7eb)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
                            <Button size="sm" variant="outline" onClick={handleSaveToDashboard} disabled={isSaving} className="flex items-center gap-2 px-3 py-2">
                                <Save className="w-4 h-4" />
                                {isSaving ? 'Saving…' : 'Save'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={handleImportJSON} className="flex items-center gap-2 px-3 py-2">
                                <Upload className="w-4 h-4" />
                                Import
                            </Button>
                            <Button size="sm" variant="outline" onClick={handleExportJSON} className="flex items-center gap-2 px-3 py-2">
                                <FileDown className="w-4 h-4" />
                                Export
                            </Button>
                            <Button size="sm" variant="default" onClick={handleDownloadPDF} className="flex items-center gap-2 px-3 py-2">
                                <Download className="w-4 h-4" />
                                PDF
                            </Button>
                        </div>

                        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" style={{ display: 'none' }} />

                        <div
                            id="resume-print-area"
                            data-page-format={state.resumeData.pageFormat}
                            style={{ flex: 1, overflow: 'hidden', background: 'var(--bg-secondary, #f9fafb)' }}
                        >
                            <ResumePreview />
                        </div>
                    </div>

                    {/* AI Suggestions Panel */}
                    {showAiPanel && (
                        <div className={cn(
                            "w-full xl:w-[400px] bg-white dark:bg-[var(--card)] rounded-xl shadow-lg overflow-hidden flex flex-col print:hidden",
                            "hidden xl:flex"
                        )} style={{ height: 750 }}>
                            <div style={{ flex: 1, overflow: 'hidden', padding: 8 }}>
                                <AiSuggestions />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default function FaloodBuilderPage() {
    return (
        <ResumeProvider>
            <Suspense fallback={<div className="flex items-center justify-center h-screen"><p>Loading builder…</p></div>}>
                <ResumeContent />
            </Suspense>
        </ResumeProvider>
    );
}
