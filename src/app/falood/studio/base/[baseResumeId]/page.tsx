"use client";

import React, { useState, useRef, Suspense, useEffect } from 'react';
import { ResumeProvider, useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { ResumeForm } from '@/components/falood/resumify/components/form/ResumeForm';
import { ResumePreview } from '@/components/falood/resumify/components/preview/ResumePreview';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, Eye, EyeOff, Palette, Settings, AlertTriangle, Upload, FileDown, Sparkles, Save, ArrowLeft, Briefcase, X } from 'lucide-react';
import { AiSuggestions } from '@/components/falood/resumify/components/preview/AiSuggestions';
import { cn } from '@/lib/utils';
import { exportResumeAsJSON, importResumeFromJSON } from '@/components/falood/resumify/utils/resumeImportExport';
import { DEFAULT_COLORS, DEFAULT_SECTIONS } from '@/components/falood/resumify/types/resume';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

/* ── Tailor Modal ── */
function TailorModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: { jobTitle: string; company: string; jobDescription: string }) => void }) {
    const [jobTitle, setJobTitle] = useState('');
    const [company, setCompany] = useState('');
    const [jobDescription, setJobDescription] = useState('');

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 16 }}>Tailor Resume for Job</h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
                </div>
                <div className="field-group">
                    <label>Job Title <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Senior Software Engineer" />
                </div>
                <div className="field-group">
                    <label>Company Name</label>
                    <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Google" />
                </div>
                <div className="field-group">
                    <label>Job Description <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <textarea
                        value={jobDescription}
                        onChange={(e) => setJobDescription(e.target.value)}
                        placeholder="Paste the full job description here..."
                        style={{ minHeight: 180, resize: 'vertical' }}
                    />
                </div>
                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button
                        className="btn-primary"
                        disabled={!jobTitle.trim() || !jobDescription.trim()}
                        onClick={() => onSubmit({ jobTitle, company, jobDescription })}
                    >
                        Tailor with AI →
                    </button>
                </div>
            </div>
        </div>
    );
}

function convertOldFormatToNew(old: any): any {
    if (!old || typeof old !== 'object') return old;
    if (old.personalInfo) return old; // Already new format
    
    // It's the old ResumeDocument format (has header, experience, education, etc)
    return {
        personalInfo: {
            fullName: old.header?.fullName || '',
            jobTitle: '',
            email: old.header?.email || '',
            phone: old.header?.phone || '',
            location: old.header?.location || '',
            linkedin: old.header?.linkedin || '',
            github: old.header?.github || '',
            portfolio: old.header?.portfolio || ''
        },
        summary: old.summary?.text || '',
        experience: Array.isArray(old.experience) ? old.experience.map((e: any) => ({
            id: e.id || Math.random().toString(),
            jobTitle: e.title || '',
            company: e.company || '',
            location: e.location || '',
            startDate: e.startDate || '',
            endDate: e.endDate || '',
            current: !e.endDate,
            description: '',
            bulletPoints: Array.isArray(e.bullets) ? e.bullets.map((b: any) => b.text || b) : []
        })) : [],
        education: Array.isArray(old.education) ? old.education.map((e: any) => ({
            id: e.id || Math.random().toString(),
            degree: e.degree || '',
            institution: e.school || '',
            location: '',
            graduationYear: e.graduationDate || '',
        })) : [],
        skills: {
            mode: 'categorized',
            simple: [],
            categorized: Array.isArray(old.skills) ? old.skills.map((s: any) => ({
                id: s.id || Math.random().toString(),
                name: s.title || '',
                skills: Array.isArray(s.skills) ? s.skills : []
            })) : []
        },
        projects: Array.isArray(old.projects) ? old.projects.map((p: any) => ({
            id: p.id || Math.random().toString(),
            title: p.title || '',
            description: '',
            technologies: [],
            bulletPoints: Array.isArray(p.bullets) ? p.bullets.map((b: any) => b.text || b) : []
        })) : [],
        customSections: Array.isArray(old.certifications) ? [{
            id: 'certs',
            title: 'Certifications',
            items: old.certifications.map((c: any) => ({
                id: c.id || Math.random().toString(),
                title: c.name || '',
                subtitle: c.issuer || '',
                date: c.date || '',
                description: ''
            }))
        }] : [],
        sections: DEFAULT_SECTIONS,
        colors: DEFAULT_COLORS,
        template: 'tech-sidebar',
        pageFormat: 'a4',
        fontSize: 'medium',
        fontFamily: 'Inter'
    };
}

/* ── Resume Content (inner component) ── */
const ResumeContent: React.FC<{ baseResumeId: string }> = ({ baseResumeId }) => {
    const [showPreview, setShowPreview] = useState(true);
    const [showAiPanel, setShowAiPanel] = useState(false);
    const [activePanel, setActivePanel] = useState<'form' | 'customize' | 'settings'>('form');
    const [pageOverflow, setPageOverflow] = useState(false);
    const [showTailorModal, setShowTailorModal] = useState(false);
    const { state, exportResumeData, importResumeData } = useResume();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [toastMsg, setToastMsg] = useState<string | null>(null);
    const [candidateId, setCandidateId] = useState<string | null>(null);
    const isNew = baseResumeId === 'new';

    const showToast = (msg: string) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(null), 3000);
    };

    // Load existing Base Resume
    useEffect(() => {
        if (!isNew) {
            const fetchBaseResume = async () => {
                setIsLoading(true);
                try {
                    const response = await fetch(`/api/base-resumes/${baseResumeId}`);
                    const json = await response.json();
                    if (json && json.content) {
                        const convertedData = convertOldFormatToNew(json.content);
                        importResumeData(convertedData);
                        setCandidateId(json.candidate_id || null);
                        showToast('Base Resume loaded.');
                    }
                } catch (error) {
                    console.error("Error fetching base resume", error);
                } finally {
                    setIsLoading(false);
                }
            };
            fetchBaseResume();
        }
    }, [baseResumeId]);

    // Page overflow detection
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
        if (success) showToast('Resume exported as JSON.');
        else showToast('Export failed.');
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            if (isNew) {
                const saveResponse = await fetch('/api/falood/applications', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jobDescription: state.jobDescription || '',
                        companyName: null,
                        skills: [],
                        resumeData: state.resumeData,
                        chatHistory: state.chatHistory,
                    }),
                });
                if (saveResponse.ok) {
                    showToast('Saved as standalone application!');
                }
            } else {
                const saveResponse = await fetch(`/api/base-resumes/${baseResumeId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: state.resumeData,
                    }),
                });
                if (saveResponse.ok) {
                    showToast('Base Resume saved!');
                } else {
                    throw new Error("Failed to save");
                }
            }
        } catch (error) {
            console.error('Error saving:', error);
            showToast('Save failed.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleTailorSubmit = async (data: { jobTitle: string; company: string; jobDescription: string }) => {
        setShowTailorModal(false);
        // Save current base resume first
        if (!isNew) {
            await fetch(`/api/base-resumes/${baseResumeId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: state.resumeData }),
            });
        }
        
        // Then create a NEW application for tailoring
        try {
            const createResponse = await fetch('/api/falood/applications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobDescription: data.jobDescription,
                    companyName: data.company,
                    skills: [],
                    resumeData: state.resumeData, // Seeded with the current base resume content
                    chatHistory: candidateId ? [{ id: "meta-candidate", role: "assistant", content: "", candidateId }] : [],
                }),
            });
            if (createResponse.ok) {
                const json = await createResponse.json();
                const savedId = json.data?.id;
                if (savedId) {
                    router.push(`/falood/studio/tailor/${savedId}?jobTitle=${encodeURIComponent(data.jobTitle)}&company=${encodeURIComponent(data.company)}`);
                }
            }
        } catch (error) {
            console.error('Error creating tailored application:', error);
            showToast('Failed to start tailoring.');
        }
    };

    const handleImportJSON = () => fileInputRef.current?.click();

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const resumeData = await importResumeFromJSON(file);
            importResumeData(resumeData);
            showToast('Resume imported.');
        } catch {
            showToast('Import failed: invalid file.');
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    if (isLoading) {
        return <div className="flex items-center justify-center h-[600px]"><p className="muted">Loading base resume…</p></div>;
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

            {showTailorModal && (
                <TailorModal
                    onClose={() => setShowTailorModal(false)}
                    onSubmit={handleTailorSubmit}
                />
            )}

            <div style={{ maxWidth: 1800, margin: '0 auto', padding: '16px 16px' }}>
                {/* Header */}
                <div className="print:hidden" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Link href={candidateId ? `/candidates/${candidateId}` : "/falood"} style={{ color: 'inherit' }}>
                            <ArrowLeft size={20} />
                        </Link>
                        <div>
                            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Falood Base Resume Builder</h1>
                            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                                {isNew ? 'New resume' : `Editing Base Resume: ${baseResumeId.slice(0, 8)}…`}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="btn" onClick={() => setShowTailorModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Briefcase size={14} /> Tailor for Job
                        </button>
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

                {/* Overflow warning */}
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
                    <Button variant={showPreview ? "default" : "outline"} size="sm" onClick={() => setShowPreview(!showPreview)} className="flex items-center gap-2">
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
                                <Button variant={activePanel === 'form' ? 'default' : 'ghost'} size="sm" onClick={() => setActivePanel('form')} style={{ borderRadius: 0, padding: '12px 24px' }}>Content</Button>
                                <Button variant={activePanel === 'customize' ? 'default' : 'ghost'} size="sm" onClick={() => setActivePanel('customize')} style={{ borderRadius: 0, padding: '12px 24px' }}><Palette className="w-4 h-4 mr-2" />Customize</Button>
                                <Button variant={activePanel === 'settings' ? 'default' : 'ghost'} size="sm" onClick={() => setActivePanel('settings')} style={{ borderRadius: 0, padding: '12px 24px' }}><Settings className="w-4 h-4 mr-2" />Settings</Button>
                            </div>
                        </div>
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                            <ResumeForm activePanel={activePanel} />
                        </div>
                    </div>

                    {/* Preview Panel */}
                    <div className={cn(
                        "w-full lg:w-auto xl:flex-1 bg-white dark:bg-[var(--card)] rounded-xl shadow-lg overflow-hidden flex flex-col",
                        "print:w-full print:h-auto print:shadow-none print:rounded-none print:block print:overflow-visible",
                        "lg:flex",
                        showPreview ? "flex" : "hidden lg:flex"
                    )} style={{ height: 750 }}>
                        <div className="print:hidden" style={{ borderBottom: '1px solid var(--border, #e5e7eb)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
                            <Button size="sm" variant="outline" onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-3 py-2">
                                <Save className="w-4 h-4" />{isSaving ? 'Saving…' : 'Save'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={handleImportJSON} className="flex items-center gap-2 px-3 py-2">
                                <Upload className="w-4 h-4" />Import
                            </Button>
                            <Button size="sm" variant="outline" onClick={handleExportJSON} className="flex items-center gap-2 px-3 py-2">
                                <FileDown className="w-4 h-4" />Export
                            </Button>
                            <Button size="sm" variant="default" onClick={handleDownloadPDF} className="flex items-center gap-2 px-3 py-2">
                                <Download className="w-4 h-4" />PDF
                            </Button>
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" style={{ display: 'none' }} />
                        <div
                            id="resume-print-area"
                            data-page-format={state.resumeData.pageFormat}
                            style={{ flex: 1, overflow: 'auto', background: 'var(--bg-secondary, #f9fafb)' }}
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

/* ── Page Wrapper ── */
export default function FaloodStudioBasePage() {
    const params = useParams<{ baseResumeId: string }>();
    const baseResumeId = params?.baseResumeId || 'new';

    return (
        <ResumeProvider>
            <Suspense fallback={<div className="flex items-center justify-center h-screen"><p>Loading builder…</p></div>}>
                <ResumeContent baseResumeId={baseResumeId} />
            </Suspense>
        </ResumeProvider>
    );
}
