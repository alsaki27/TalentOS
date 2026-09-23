"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, ArrowLeft, Briefcase, FileText, Download, Trash2, Plus } from 'lucide-react';

interface SavedApplication {
    id: string;
    createdAt: string;
    updatedAt: string;
    jobDescription: string | null;
    companyName: string | null;
    skills: string[];
    resumeData: any;
    chatHistory: any;
}

export default function FaloodDashboardPage() {
    const [applications, setApplications] = useState<SavedApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [toastMsg, setToastMsg] = useState<string | null>(null);

    const showToast = (msg: string) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(null), 3000);
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        if (!confirm('Are you sure you want to delete this saved application?')) {
            return;
        }

        try {
            const res = await fetch(`/api/falood/applications?id=${id}`, {
                method: 'DELETE'
            });
            const json = await res.json();

            if (json.success) {
                setApplications(prev => prev.filter(app => app.id !== id));
                showToast('Application deleted.');
            } else {
                throw new Error(json.error || 'Failed to delete');
            }
        } catch (error: any) {
            showToast(error.message || 'Could not delete application.');
        }
    };

    useEffect(() => {
        const fetchApps = async () => {
            try {
                const res = await fetch('/api/falood/applications');
                const json = await res.json();
                if (json.success) {
                    setApplications(json.data);
                }
            } catch (error) {
                console.error("Failed to fetch applications", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchApps();
    }, []);

    // Aggregate skills
    const skillCounts: Record<string, number> = {};
    applications.forEach(app => {
        app.skills?.forEach(s => {
            const normalized = s.toLowerCase().trim();
            if (normalized) {
                skillCounts[normalized] = (skillCounts[normalized] || 0) + 1;
            }
        });
    });

    const sortedSkills = Object.entries(skillCounts)
        .sort((a, b) => b[1] - a[1]);

    const tailoredResumes = applications.filter(app => (app.jobDescription || '').trim().length > 0);
    const savedResumes = applications.filter(app => (app.jobDescription || '').trim().length === 0);

    return (
        <>
            {/* Toast notification */}
            {toastMsg && (
                <div style={{
                    position: 'fixed', top: 20, right: 20, zIndex: 9999,
                    padding: '12px 20px', borderRadius: 8,
                    background: 'var(--accent, #3b82f6)', color: '#fff',
                    fontSize: 13, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                }}>
                    {toastMsg}
                </div>
            )}

            <div className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Link href="/falood" style={{ color: 'inherit' }}>
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1>Resume Dashboard</h1>
                        <p className="page-kicker">Manage saved resumes and tailored resumes</p>
                    </div>
                </div>
                <Link href="/falood/builder">
                    <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Plus size={16} /> New Resume
                    </button>
                </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* Skills Summary Card */}
                <div className="card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <Briefcase size={18} style={{ color: 'var(--accent)' }} />
                        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Aggregated Job Skills</h2>
                    </div>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Most requested skills from your saved job descriptions</p>
                    {applications.length === 0 ? (
                        <p className="muted" style={{ fontSize: 13, textAlign: 'center', padding: 16 }}>No applications saved yet.</p>
                    ) : sortedSkills.length === 0 ? (
                        <p className="muted" style={{ fontSize: 13, textAlign: 'center', padding: 16 }}>No skills extracted from your job descriptions.</p>
                    ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {sortedSkills.map(([skill, count]) => (
                                <span key={skill} className="badge" style={{ fontSize: 12 }}>
                                    {skill} {count > 1 ? `(${count})` : ''}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Stats Card */}
                <div className="card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <FileText size={18} style={{ color: 'var(--accent)' }} />
                        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Resume Stats</h2>
                    </div>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Overview of your saved progress</p>
                    <div className="stats-strip">
                        <div className="stat-card">
                            <span className="stat-value">{savedResumes.length}</span>
                            <span className="stat-label">Saved Resumes</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-value">{tailoredResumes.length}</span>
                            <span className="stat-label">Tailored Resumes</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-value">{sortedSkills.length}</span>
                            <span className="stat-label">Unique Skills</span>
                        </div>
                    </div>
                </div>
            </div>

            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Download size={16} /> Tailored Resumes
                </span>
            </h2>

            {isLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
                    <Loader2 className="animate-spin" size={32} style={{ color: 'var(--accent)' }} />
                </div>
            ) : tailoredResumes.length === 0 ? (
                <div className="empty" style={{ textAlign: 'center', padding: '80px 0' }}>
                    <h3>No tailored resumes yet</h3>
                    <p className="muted" style={{ marginTop: 8 }}>Tailor a resume from a candidate profile to see it here.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {tailoredResumes.map((app) => {
                        const roleTitle = app.resumeData?.personalInfo?.jobTitle || "Untitled Resume";
                        const companyName = app.companyName || "Unknown company";

                        return (
                            <Link key={app.id} href={`/falood/studio/tailor/${app.id}`} className="no-underline" style={{ color: 'inherit' }}>
                                <div className="card" style={{ cursor: 'pointer', transition: 'box-shadow 0.2s', height: '100%' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                        <span className="badge" style={{ fontSize: 10 }}>
                                            {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                                        </span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            {app.skills?.length > 0 && (
                                                <span style={{ fontSize: 10, fontWeight: 600, color: '#059669', background: '#ecfdf5', padding: '2px 8px', borderRadius: 12 }}>
                                                    {app.skills.length} skills
                                                </span>
                                            )}
                                            <button
                                                onClick={(e) => handleDelete(e, app.id)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--muted-foreground)' }}
                                                title="Delete"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {app.resumeData?.personalInfo?.fullName || roleTitle}
                                    </h3>
                                    <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        Tailored for: {companyName}
                                    </p>
                                    <div style={{ height: 60, fontSize: 11, color: 'var(--muted-foreground)', overflow: 'hidden', position: 'relative', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 6, padding: 8 }}>
                                        {app.jobDescription || "No job description provided."}
                                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 24, background: 'linear-gradient(transparent, var(--bg-secondary, #f9fafb))' }} />
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}

            <h2 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 12px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={16} /> Saved Resumes
                </span>
            </h2>

            {isLoading ? null : savedResumes.length === 0 ? (
                <div className="empty" style={{ textAlign: 'center', padding: '40px 0' }}>
                    <h3>No saved resumes yet</h3>
                    <p className="muted" style={{ marginTop: 8 }}>Go to the builder, create a resume, and click "Save".</p>
                    <Link href="/falood/builder">
                        <button className="btn-primary" style={{ marginTop: 16 }}>Open Builder</button>
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {savedResumes.map((app) => {
                        const roleTitle = app.resumeData?.personalInfo?.jobTitle || "Untitled Resume";
                        const displayName = app.resumeData?.personalInfo?.fullName || roleTitle;

                        return (
                            <Link key={app.id} href={`/falood/builder?id=${app.id}`} className="no-underline" style={{ color: 'inherit' }}>
                                <div className="card" style={{ cursor: 'pointer', transition: 'box-shadow 0.2s', height: '100%' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                        <span className="badge" style={{ fontSize: 10 }}>
                                            {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                                        </span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <button
                                                onClick={(e) => handleDelete(e, app.id)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--muted-foreground)' }}
                                                title="Delete"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {displayName}
                                    </h3>
                                    <p className="muted" style={{ fontSize: 12, margin: '4px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {roleTitle}
                                    </p>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </>
    );
}
