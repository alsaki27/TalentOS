import React, { useCallback, useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Check, X, ArrowRight, Lightbulb, RefreshCw, Send, MessageSquare, Bot, User } from 'lucide-react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface SkillCategory {
    id: string;
    name: string;
    skills: string[];
}

interface Suggestion {
    id: string;
    type: 'experience' | 'experience_add' | 'experience_remove' | 'skill' | 'skill_remove' | 'summary' | 'skill_reorg' | 'personal_info';
    title: string;
    description: string;
    original?: string;
    suggested: string | string[] | SkillCategory[];
    targetId?: string; // ID of the experience item or skill category
    subId?: string; // ID of the specific skill category if needed
    status?: 'accepted' | 'rejected' | 'pending';
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    suggestions?: Suggestion[];
}

export const AiSuggestions: React.FC = () => {
    const { state, updateExperience, updateSkills, updateSummary, updatePersonalInfo, setChatHistory, setJobDescription } = useResume();
    const { chatHistory: messages, jobDescription } = state;
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const autoSuggestRanRef = useRef(false);

    // Initial suggestions (empty now, waiting for user input)
    // We no longer need a separate 'suggestions' state for the bottom view if we render them in chat.
    // However, for the "summary badge" at top, we might want to count pending ones.
    // Let's derive pending count from messages.

    const scrollAreaRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom of chat
    useEffect(() => {
        if (scrollAreaRef.current) {
            const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        }
    }, [messages, isTyping]);

    const handleAccept = (suggestion: Suggestion, messageId: string) => {
        // Logic to update resume data
        if (suggestion.type === 'summary') {
            updateSummary(suggestion.suggested as string);
        } else if (suggestion.type === 'personal_info' && suggestion.targetId) {
            const allowed: Record<string, boolean> = {
                fullName: true,
                jobTitle: true,
                email: true,
                phone: true,
                location: true,
                website: true,
                linkedin: true,
                github: true,
                birthDate: true,
            };

            if (allowed[suggestion.targetId]) {
                updatePersonalInfo({ [suggestion.targetId]: suggestion.suggested as string } as any);
            }
        } else if (suggestion.type === 'experience' && suggestion.targetId) {
            const updatedExperience = state.resumeData.experience.map(exp => {
                if (exp.id === suggestion.targetId) {
                    // Try to find exact match first
                    let targetIndex = exp.bulletPoints.findIndex(bp => bp === suggestion.original);

                    // If no exact match, try fuzzy match (ignore whitespace/case)
                    if (targetIndex === -1 && suggestion.original) {
                        const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
                        const normalizedOriginal = normalize(suggestion.original);
                        targetIndex = exp.bulletPoints.findIndex(bp => normalize(bp).includes(normalizedOriginal) || normalizedOriginal.includes(normalize(bp)));
                    }

                    if (targetIndex !== -1) {
                        const updatedBullets = [...exp.bulletPoints];
                        updatedBullets[targetIndex] = suggestion.suggested as string;
                        return { ...exp, bulletPoints: updatedBullets };
                    }
                }
                return exp;
            });
            updateExperience(updatedExperience);
        } else if (suggestion.type === 'experience_add' && suggestion.targetId) {
            const newBullet = (suggestion.suggested as string)?.trim();
            if (!newBullet) return;

            const updatedExperience = state.resumeData.experience.map(exp => {
                if (exp.id !== suggestion.targetId) return exp;
                if (exp.bulletPoints.includes(newBullet)) return exp;
                return { ...exp, bulletPoints: [...exp.bulletPoints, newBullet] };
            });
            updateExperience(updatedExperience);
        } else if (suggestion.type === 'experience_remove' && suggestion.targetId) {
            const original = suggestion.original || (typeof suggestion.suggested === 'string' ? suggestion.suggested : '');
            if (!original) return;

            const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
            const normalizedOriginal = normalize(original);

            const updatedExperience = state.resumeData.experience.map(exp => {
                if (exp.id !== suggestion.targetId) return exp;
                const updatedBullets = exp.bulletPoints.filter(bp => normalize(bp) !== normalizedOriginal);
                return { ...exp, bulletPoints: updatedBullets };
            });
            updateExperience(updatedExperience);
        } else if (suggestion.type === 'skill' && suggestion.targetId) {
            const newSkills = suggestion.suggested as string[];
            const updatedCategories = state.resumeData.skills.categorized.map(cat => {
                if (cat.id === suggestion.targetId) {
                    const uniqueNewSkills = newSkills.filter(s => !cat.skills.includes(s));
                    return { ...cat, skills: [...cat.skills, ...uniqueNewSkills] };
                }
                return cat;
            });

            updateSkills({
                ...state.resumeData.skills,
                categorized: updatedCategories
            });
        } else if (suggestion.type === 'skill_remove' && suggestion.targetId) {
            const removeSkills = (suggestion.suggested as string[]) || [];
            const removeSet = new Set(removeSkills.map(s => s.trim().toLowerCase()).filter(Boolean));

            const updatedCategories = state.resumeData.skills.categorized.map(cat => {
                if (cat.id !== suggestion.targetId) return cat;
                return { ...cat, skills: cat.skills.filter(s => !removeSet.has(s.trim().toLowerCase())) };
            });

            updateSkills({
                ...state.resumeData.skills,
                categorized: updatedCategories
            });
        } else if (suggestion.type === 'skill_reorg') {
            // Handle full reorganization of skills
            const newCategories = suggestion.suggested as SkillCategory[];
            if (Array.isArray(newCategories)) {
                updateSkills({
                    ...state.resumeData.skills,
                    categorized: newCategories
                });
            }
        }

        // Mark as accepted in the message history
        setChatHistory(messages.map(msg => {
            if (msg.id === messageId && msg.suggestions) {
                return {
                    ...msg,
                    suggestions: msg.suggestions.map((s: Suggestion) =>
                        s.id === suggestion.id ? { ...s, status: 'accepted' } : s
                    )
                };
            }
            return msg;
        }));
    };

    const handleReject = (suggestionId: string, messageId: string) => {
        // Mark as rejected in the message history
        setChatHistory(messages.map(msg => {
            if (msg.id === messageId && msg.suggestions) {
                return {
                    ...msg,
                    suggestions: msg.suggestions.map((s: Suggestion) =>
                        s.id === suggestionId ? { ...s, status: 'rejected' } : s
                    )
                };
            }
            return msg;
        }));
    };

    const fetchAiSuggestions = useCallback(async (apiMessages: { role: string; content: string }[], jd: string) => {
        const response = await fetch('/api/falood/suggestions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                resume: state.resumeData,
                jobDescription: jd,
                messages: apiMessages
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to get suggestions from AI');
        }

        const data = await response.json();
        return (data.suggestions || []) as Suggestion[];
    }, [state.resumeData]);

    const handleSendMessage = async () => {
        if (!input.trim()) return;

        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: input
        };

        const newMessages = [...messages, userMsg];
        setChatHistory(newMessages);

        const currentInput = input;

        // Very basic heuristic: if input looks like a JD (e.g., long text, has words like "requirements", "skills", "experience")
        // or just store it if it's the first long message
        if (currentInput.length > 100 && !state.jobDescription) {
            setJobDescription(currentInput);
        }

        setInput('');
        setIsTyping(true);

        try {
            // Prepare messages for API (remove generic ids or extra fields if needed, but backend handles it)
            const apiMessages = newMessages.map(m => ({
                role: m.role,
                content: m.content
            }));
            const newSuggestions: Suggestion[] = await fetchAiSuggestions(
                apiMessages,
                state.jobDescription || currentInput
            );

            const aiMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: newSuggestions.length > 0
                    ? 'I have initialized some suggestions for you based on our conversation.'
                    : 'I acknowledged that. Is there anything specific on the resume you would like to work on?',
                suggestions: newSuggestions.map(s => ({ ...s, status: 'pending' }))
            };

            setChatHistory([...newMessages, aiMsg]);
        } catch (error) {
            console.error('Error fetching suggestions:', error);
            const errorMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Sorry, I encountered an error. Please ensure the backend server is running.'
            };
            setChatHistory([...newMessages, errorMsg]);
        } finally {
            setIsTyping(false);
        }
    };

    useEffect(() => {
        const hasSuggestions = messages.some(m => Array.isArray(m.suggestions) && m.suggestions.length > 0);
        const hasUserMessage = messages.some(m => m.role === 'user' && m.content?.trim());

        if (autoSuggestRanRef.current) return;
        if (isTyping) return;
        if (hasSuggestions) return;
        if (hasUserMessage) return;
        if (!jobDescription || jobDescription.trim().length < 80) return;

        autoSuggestRanRef.current = true;
        setIsTyping(true);

        const seedInstruction = [
            "Please generate initial, high-impact resume improvements against the provided job description.",
            "Return suggestions that are safe to accept/reject (no destructive overwrites).",
            "no need to add a section by default if that section is empty. only add if asked",
            "If adding skills, only propose the NEW skills to add; do not reorganize the whole skills section unless explicitly requested.",
            "If a personal info change is relevant, propose it as a personal_info suggestion (e.g., fullName).",
        ].join("\n");

        const apiMessages = [
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: "user", content: seedInstruction }
        ];

        fetchAiSuggestions(apiMessages, jobDescription)
            .then((newSuggestions) => {
                const aiMsg: ChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: newSuggestions.length > 0
                        ? 'Here are some initial suggestions based on your resume and the job description.'
                        : 'I loaded the job description. Ask me what you want to improve, and I’ll propose changes you can accept or reject.',
                    suggestions: newSuggestions.map(s => ({ ...s, status: 'pending' }))
                };
                setChatHistory([...messages, aiMsg]);
            })
            .catch(() => {
                const errorMsg: ChatMessage = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: 'Sorry, I could not generate initial suggestions. Try sending a message like “suggest improvements for this JD”.'
                };
                setChatHistory([...messages, errorMsg]);
            })
            .finally(() => setIsTyping(false));
    }, [jobDescription, messages, isTyping, setChatHistory, fetchAiSuggestions]);

    return (
        <div className="flex flex-col h-full gap-2 relative">
            <div className="flex items-center justify-between px-1 pb-2 border-b">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-indigo-500" />
                    <h2 className="font-semibold text-sm">AI Copilot</h2>
                </div>
            </div>

            <ScrollArea className="flex-1 -mx-2 px-2" ref={scrollAreaRef}>
                <div className="flex flex-col gap-4 pb-4">
                    {messages.map((msg) => {
                        const hasSuggestions = Array.isArray(msg.suggestions) && msg.suggestions.length > 0;
                        const hasText = typeof msg.content === 'string' && msg.content.trim().length > 0;
                        if (!hasText && !hasSuggestions) return null;

                        return (
                        <div key={msg.id} className={cn("flex flex-col gap-2", msg.role === 'user' ? "items-end" : "items-start")}>
                            <div className="flex gap-2 max-w-[95%]">
                                {msg.role === 'assistant' && (
                                    <div className="h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0 mt-0.5">
                                        <Bot className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                                    </div>
                                )}
                                <div className="flex flex-col gap-2">
                                    <div className={cn(
                                        "rounded-lg p-3 text-xs leading-relaxed",
                                        msg.role === 'user'
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground"
                                    )}>
                                        {msg.content}
                                    </div>

                                    {/* Render Suggestions embedded in the message */}
                                    {msg.suggestions && msg.suggestions.length > 0 && (
                                        <div className="flex flex-col gap-2 mt-1">
                                            {msg.suggestions.map((suggestion: Suggestion) => (
                                                <Card key={suggestion.id} className={cn(
                                                    "border shadow-sm overflow-hidden transition-all",
                                                    suggestion.status === 'accepted' ? "opacity-50 bg-green-50/30 border-green-200" :
                                                        suggestion.status === 'rejected' ? "opacity-40 bg-red-50/30 border-red-100 grayscale" : ""
                                                )}>
                                                    <CardHeader className="p-3 pb-2 bg-muted/30 border-b flex flex-row items-center justify-between space-y-0">
                                                        <CardTitle className="text-sm leading-tight">{suggestion.title}</CardTitle>
                                                        {suggestion.status === 'accepted' && <Badge variant="outline" className="text-[10px] text-green-600 border-green-200 bg-green-50">Accepted</Badge>}
                                                        {suggestion.status === 'rejected' && <Badge variant="outline" className="text-[10px] text-red-600 border-red-200 bg-red-50">Rejected</Badge>}
                                                    </CardHeader>
                                                    <CardContent className="p-3 text-xs space-y-3">
                                                        <div className="flex justify-between items-start">
                                                            <Badge variant="outline" className={cn("text-[10px] h-5 border-0 mb-2",
                                                                suggestion.type === 'experience' ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300" :
                                                                    (suggestion.type === 'skill' || suggestion.type === 'skill_reorg') ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" :
                                                                        "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                                                            )}>
                                                                {suggestion.type === 'skill_reorg' ? 'SKILLS REORG' : suggestion.type.toUpperCase()}
                                                            </Badge>
                                                        </div>
                                                        {suggestion.original && (
                                                            <div className="space-y-1.5">
                                                                <span className="text-[10px] uppercase font-semibold text-muted-foreground">Original</span>
                                                                <div className="p-2 bg-red-50/50 dark:bg-red-950/20 rounded text-muted-foreground line-through decoration-red-400/30 text-[11px] leading-relaxed">
                                                                    {suggestion.original}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="space-y-1.5">
                                                            <span className="text-[10px] uppercase font-semibold text-muted-foreground">Suggested Change</span>
                                                            <div className="p-2 bg-green-50/80 dark:bg-green-950/20 rounded font-medium border border-green-100/50 dark:border-green-900/20 text-[11px] leading-relaxed text-foreground">
                                                                {(() => {
                                                                    const parseSuggested = (raw: any): any => {
                                                                        // If it's a string that looks like JSON, parse it
                                                                        if (typeof raw === 'string') {
                                                                            try {
                                                                                return JSON.parse(raw);
                                                                            } catch {
                                                                                return raw; // plain string
                                                                            }
                                                                        }
                                                                        return raw;
                                                                    };

                                                                    const renderContent = (s: any, idx: number) => {
                                                                        // Unwrap {categorized, simple, mode} shape from skill_reorg
                                                                        if (s && typeof s === 'object' && 'categorized' in s && Array.isArray(s.categorized)) {
                                                                            return (
                                                                                <div key={idx} className="flex flex-col gap-2">
                                                                                    {s.categorized.map((cat: any, k: number) => (
                                                                                        <div key={k} className="flex flex-col gap-1">
                                                                                            <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">{cat.name}</span>
                                                                                            <div className="flex flex-wrap gap-1">
                                                                                                {cat.skills?.map((skill: string, sk: number) => (
                                                                                                    <Badge key={sk} variant="secondary" className="bg-background text-[10px] h-5 px-1.5 font-normal border shadow-sm">{skill}</Badge>
                                                                                                ))}
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            );
                                                                        }
                                                                        if (typeof s === 'string') {
                                                                            return <Badge key={idx} variant="secondary" className="bg-background text-[10px] h-5 px-1.5 font-normal border shadow-sm">{s}</Badge>;
                                                                        }
                                                                        if (typeof s === 'object' && s !== null) {
                                                                            if ('name' in s && 'skills' in s && Array.isArray(s.skills)) {
                                                                                return (
                                                                                    <div key={idx} className="flex flex-col gap-1 mt-1 mb-1">
                                                                                        <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">{s.name}</span>
                                                                                        <div className="flex flex-wrap gap-1">
                                                                                            {s.skills.map((skill: any, k: number) => (
                                                                                                <Badge key={k} variant="secondary" className="bg-background text-[10px] h-5 px-1.5 font-normal border shadow-sm">
                                                                                                    {typeof skill === 'string' ? skill : JSON.stringify(skill)}
                                                                                                </Badge>
                                                                                            ))}
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            }
                                                                        }
                                                                        return null;
                                                                    };

                                                                    const parsed = parseSuggested(suggestion.suggested);

                                                                    if (Array.isArray(parsed)) {
                                                                        return (
                                                                            <div className="flex flex-col gap-1">
                                                                                {parsed.map((s: any, i: number) => renderContent(s, i))}
                                                                            </div>
                                                                        );
                                                                    } else {
                                                                        return renderContent(parsed, 0);
                                                                    }
                                                                })()}
                                                            </div>
                                                        </div>
                                                    </CardContent>

                                                    {(!suggestion.status || suggestion.status === 'pending') && (
                                                        <CardFooter className="p-2 flex justify-end gap-2 bg-muted/10 border-t">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-7 text-xs px-2.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                                                onClick={() => handleReject(suggestion.id, msg.id)}
                                                            >
                                                                Reject
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                className="h-7 text-xs px-3 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                                                                onClick={() => handleAccept(suggestion, msg.id)}
                                                            >
                                                                Accept Change
                                                            </Button>
                                                        </CardFooter>
                                                    )}
                                                </Card>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {msg.role === 'user' && (
                                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                                        <User className="h-3.5 w-3.5 text-primary" />
                                    </div>
                                )}
                            </div>
                        </div>
                        );
                    })}

                    {isTyping && (
                        <div className="flex gap-2 items-center">
                            <div className="h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
                                <Bot className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <div className="flex gap-1 items-center bg-muted text-muted-foreground rounded-lg p-3 w-fit h-9">
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    )}
                </div>
            </ScrollArea>

            <div className="pt-3 border-t mt-auto px-1 bg-background z-10">
                <div className="relative">
                    <Textarea
                        placeholder="Paste job description or ask for changes..."
                        className="min-h-[80px] pr-10 resize-none text-xs focus-visible:ring-indigo-500"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendMessage();
                            }
                        }}
                    />
                    <Button
                        size="icon"
                        className="absolute bottom-2 right-2 h-7 w-7 bg-indigo-600 hover:bg-indigo-700"
                        onClick={handleSendMessage}
                        disabled={!input.trim() || isTyping}
                    >
                        <Send className="h-3.5 w-3.5" />
                    </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                    AI-generated suggestions. Review carefully before accepting.
                </p>
            </div>
        </div>
    );
};
