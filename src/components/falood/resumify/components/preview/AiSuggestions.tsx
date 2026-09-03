import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Check, X, ArrowRight, Lightbulb, RefreshCw, Send, MessageSquare, Bot, User } from 'lucide-react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { flattenResumeSkills } from '@/lib/falood/skillGapDetector';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { ResumeData } from '@/components/falood/resumify/types/resume';
import { applySuggestionToResumeData, type Suggestion } from '@/lib/falood/applySuggestionToResumeData';

// Re-exported so existing `import { applySuggestionToResumeData } from
// '.../AiSuggestions'` call sites (e.g. ResumePreview.tsx) keep working
// unchanged - the implementation itself now lives in
// src/lib/falood/applySuggestionToResumeData.ts (a plain .ts module, since
// this project's test runner can't parse JSX imported from a .test.ts file).
export { applySuggestionToResumeData, type Suggestion };

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    suggestions?: Suggestion[];
}


interface SkillGapItem {
    skill: string;
    isRequiredByJob: boolean;
    /** Which existing skill category (by id) this skill belongs to, per the server's AI classification against the resume's actual category names. Undefined falls back to the first category (applySuggestionToResumeData's existing behavior). */
    categoryId?: string;
}

/** Builds a one-skill Suggestion card for the skill-gap queue, wording the reason by whether the JD names it as a required skill vs. a related/preferred one. targetId routes the accept action to the matching skill category instead of always landing in the first one. */
function buildSkillGapSuggestion(item: SkillGapItem): Suggestion {
    return {
        id: `skill-gap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'skill',
        title: `Add missing skill: ${item.skill}`,
        description: item.isRequiredByJob
            ? 'Required by this job description, and not yet on this tailored draft.'
            : 'Related to this job description and supported by your background, but not yet on this tailored draft.',
        suggested: [item.skill],
        targetId: item.categoryId,
        status: 'pending',
    };
}

export const AiSuggestions: React.FC<{ candidateId?: string | null }> = ({ candidateId }) => {
    const { state, importResumeData, setChatHistory, setJobDescription, setPreviewSuggestion } = useResume();
    const { chatHistory: messages, jobDescription } = state;
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    // const autoSuggestRanRef = useRef(false); // only used by the disabled general auto-suggest effect below
    const skillGapTriggeredRef = useRef(false);

    // Initial suggestions (empty now, waiting for user input)
    // We no longer need a separate 'suggestions' state for the bottom view if we render them in chat.
    // However, for the "summary badge" at top, we might want to count pending ones.
    // Let's derive pending count from messages.

    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const prevMessageCountRef = useRef<number>(messages.length);
    const prevLastMessageIdRef = useRef<string | undefined>(messages[messages.length - 1]?.id);
    const prevIsTypingRef = useRef<boolean>(isTyping);
    const localStorageKeyRef = useRef<string | null>(null);
    const hasInitializedStorageRef = useRef(false);
    const skipNextPersistRef = useRef(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const path = window.location.pathname;
        const url = new URL(window.location.href);
        const key = `falood-ai-chat:${path}`;
        localStorageKeyRef.current = key;

        const shouldRestore =
            !path.includes('/falood/studio/tailor/') &&
            !url.searchParams.get('id') &&
            messages.length === 1 &&
            messages[0]?.id === 'welcome';

        if (!shouldRestore) {
            hasInitializedStorageRef.current = true;
            return;
        }

        const raw = window.localStorage.getItem(key);
        if (!raw) {
            hasInitializedStorageRef.current = true;
            return;
        }

        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 1) {
                skipNextPersistRef.current = true;
                setChatHistory(parsed);
            }
        } catch { }
        hasInitializedStorageRef.current = true;
    }, [setChatHistory]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!hasInitializedStorageRef.current) return;
        if (skipNextPersistRef.current) {
            skipNextPersistRef.current = false;
            return;
        }
        const key = localStorageKeyRef.current ?? `falood-ai-chat:${window.location.pathname}`;
        localStorageKeyRef.current = key;

        try {
            window.localStorage.setItem(key, JSON.stringify(messages));
        } catch { }
    }, [messages]);

    // Auto-scroll to bottom of chat
    useEffect(() => {
        const currentLastMessageId = messages[messages.length - 1]?.id;
        const shouldAutoScroll =
            messages.length > prevMessageCountRef.current ||
            currentLastMessageId !== prevLastMessageIdRef.current ||
            (isTyping && !prevIsTypingRef.current);

        prevMessageCountRef.current = messages.length;
        prevLastMessageIdRef.current = currentLastMessageId;
        prevIsTypingRef.current = isTyping;

        if (!shouldAutoScroll) return;

        const scrollRoot = scrollAreaRef.current;
        if (!scrollRoot) return;

        const scrollContainer = scrollRoot.querySelector('[data-radix-scroll-area-viewport]');
        if (!scrollContainer) return;

        scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }, [messages, isTyping]);

    const pendingSuggestionsCount = useMemo(() => {
        let count = 0;
        for (const msg of messages) {
            for (const s of msg.suggestions ?? []) {
                if ((s.status ?? 'pending') === 'pending') count += 1;
            }
        }
        return count;
    }, [messages]);



    const handleAccept = (suggestion: Suggestion, messageId: string) => {
        const nextResumeData = applySuggestionToResumeData(state.resumeData, suggestion);
        // applySuggestionToResumeData returns the input unchanged (same
        // content, new top-level object) whenever it can't find a match -
        // detect that instead of always marking the suggestion "accepted",
        // which previously hid every failed match from the user entirely.
        const applied = JSON.stringify(nextResumeData) !== JSON.stringify(state.resumeData);

        if (applied) {
            importResumeData(nextResumeData);
        }

        setChatHistory(messages.map(msg => {
            if (msg.id !== messageId || !msg.suggestions) return msg;
            return {
                ...msg,
                suggestions: msg.suggestions.map((s: Suggestion) =>
                    s.id === suggestion.id ? { ...s, status: applied ? 'accepted' : 'failed' } : s
                )
            };
        }));
    };

    const handleAcceptAll = () => {
        const pending: { suggestion: Suggestion; messageId: string }[] = [];
        for (const msg of messages) {
            for (const s of msg.suggestions ?? []) {
                if ((s.status ?? 'pending') === 'pending') {
                    pending.push({ suggestion: s, messageId: msg.id });
                }
            }
        }

        if (pending.length === 0) return;

        const resultStatus = new Map<string, 'accepted' | 'failed'>();
        let acc = state.resumeData;
        for (const { suggestion } of pending) {
            const next = applySuggestionToResumeData(acc, suggestion);
            const applied = JSON.stringify(next) !== JSON.stringify(acc);
            resultStatus.set(suggestion.id, applied ? 'accepted' : 'failed');
            if (applied) acc = next;
        }

        importResumeData(acc);

        setChatHistory(messages.map(msg => {
            if (!msg.suggestions) return msg;
            return {
                ...msg,
                suggestions: msg.suggestions.map((s: Suggestion) =>
                    resultStatus.has(s.id) ? { ...s, status: resultStatus.get(s.id)! } : s
                ),
            };
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
                messages: apiMessages,
                candidateId: candidateId || undefined,
            }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            // Surface the real server error (e.g. an AI provider failure) instead
            // of a hardcoded generic message that hides what actually broke.
            throw new Error(data?.error || 'Failed to get suggestions from AI');
        }
        // `reply` is the model's own message when it responded conversationally
        // instead of (or alongside) suggestions - e.g. declining to add
        // something it has no evidence for. Show it verbatim so the user knows
        // why nothing was proposed, rather than a generic canned line.
        return {
            suggestions: (data.suggestions || []) as Suggestion[],
            reply: typeof data.reply === 'string' ? data.reply : undefined,
        };
    }, [state.resumeData, candidateId]);

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
            // Prepare messages for API. Include suggestion context so the AI knows what it previously proposed and its status.
            const apiMessages = newMessages.map(m => {
                if (m.role === 'assistant' && m.suggestions && m.suggestions.length > 0) {
                    const suggsText = m.suggestions.map((s: any) => 
                        `- [${s.status?.toUpperCase() || 'PENDING'}] Type: ${s.type}, Suggested: ${JSON.stringify(s.suggested)}`
                    ).join('\n');
                    return { role: m.role, content: `${m.content}\n\nMy Previous Suggestions:\n${suggsText}` };
                }
                return { role: m.role, content: m.content };
            });
            const { suggestions: newSuggestions, reply } = await fetchAiSuggestions(
                apiMessages,
                state.jobDescription || currentInput
            );

            const aiMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: reply
                    ? reply
                    : newSuggestions.length > 0
                        ? 'I have initialized some suggestions for you based on our conversation.'
                        : 'I acknowledged that. Is there anything specific on the resume you would like to work on?',
                suggestions: newSuggestions.map((s, index) => ({ 
                    ...s, 
                    id: `sugg-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
                    status: 'pending' 
                }))
            };

            setChatHistory([...newMessages, aiMsg]);
        } catch (error) {
            console.error('Error fetching suggestions:', error);
            const errorMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Sorry, I ran into an error: ${error instanceof Error ? error.message : String(error)}`
            };
            setChatHistory([...newMessages, errorMsg]);
        } finally {
            setIsTyping(false);
        }
    };

    // Disabled 2026-08-25 per explicit user request - this general "generate
    // initial improvements" auto-trigger was the actual source of two
    // confirmed complaints, even after the skill-gap flow below shipped:
    // (1) it let the AI return a bulk "skill_reorg"-shaped suggestion
    //     bundling many skills into one accept/reject action ("14 pending" +
    //     "Accept all"), not the one-at-a-time review this feature exists
    //     for; (2) it proposed experience-bullet rewrites the user never
    //     asked for. The dedicated skill-gap effect further below already
    //     covers "give me skill suggestions automatically, one at a time"
    //     correctly (verified live). Manual, explicit chat requests (typed
    //     into the input and sent) are a completely separate code path
    //     (handleSend) and are NOT affected by this being commented out -
    //     only the unsolicited auto-fire on session load is disabled.
    // To re-enable: uncomment this block. Consider constraining the seed
    // instruction to forbid experience-type suggestions and skill_reorg
    // bundling before doing so, per the reasons above.
    //
    // useEffect(() => {
    //     const hasSuggestions = messages.some(m => Array.isArray(m.suggestions) && m.suggestions.length > 0);
    //     const hasUserMessage = messages.some(m => m.role === 'user' && m.content?.trim());
    //
    //     if (autoSuggestRanRef.current) return;
    //     if (isTyping) return;
    //     if (hasSuggestions) return;
    //     if (hasUserMessage) return;
    //     if (!jobDescription || jobDescription.trim().length < 80) return;
    //
    //     autoSuggestRanRef.current = true;
    //     setIsTyping(true);
    //
    //     const seedInstruction = [
    //         "Please generate initial, high-impact resume improvements against the provided job description.",
    //         "Return suggestions that are safe to accept/reject (no destructive overwrites).",
    //         "no need to add a section by default if that section is empty. only add if asked",
    //         "If adding skills, only propose the NEW skills to add; do not reorganize the whole skills section unless explicitly requested.",
    //         "If a personal info change is relevant, propose it as a personal_info suggestion (e.g., fullName).",
    //     ].join("\n");
    //
    //     const apiMessages = [
    //         ...messages.map(m => ({ role: m.role, content: m.content })),
    //         { role: "user", content: seedInstruction }
    //     ];
    //
    //     fetchAiSuggestions(apiMessages, jobDescription)
    //         .then(({ suggestions: newSuggestions, reply }) => {
    //             const aiMsg: ChatMessage = {
    //                 id: (Date.now() + 1).toString(),
    //                 role: 'assistant',
    //                 content: reply
    //                     ? reply
    //                     : newSuggestions.length > 0
    //                         ? 'Here are some initial suggestions based on your resume and the job description.'
    //                         : 'I loaded the job description. Ask me what you want to improve, and Iâ€™ll propose changes you can accept or reject.',
    //                 suggestions: newSuggestions.map(s => ({ ...s, status: 'pending' }))
    //             };
    //             setChatHistory([...messages, aiMsg]);
    //         })
    //         .catch(() => {
    //             const errorMsg: ChatMessage = {
    //                 id: (Date.now() + 1).toString(),
    //                 role: 'assistant',
    //                 content: 'Sorry, I could not generate initial suggestions. Try sending a message like â€œsuggest improvements for this JDâ€.'
    //             };
    //             setChatHistory([...messages, errorMsg]);
    //         })
    //         .finally(() => setIsTyping(false));
    // }, [jobDescription, messages, isTyping, setChatHistory, fetchAiSuggestions]);

    // Deterministic skill-gap suggestions (see docs/FALOOD_COPILOT_SKILL_GAP_SUGGESTIONS_PLAN_2026-08-24.md).
    // Separate from the general auto-suggest effect above on purpose: which
    // skills are missing vs. present is exact, checkable data, not something
    // worth leaving to AI judgment. Fires once per session (guarded by the
    // 'skill-gap-intro' marker persisting in chatHistory, same pattern the
    // page already uses for its 'tailor-context' seed message).
    //
    // Renders every missing skill as its own separate card, all at once -
    // per explicit user request 2026-08-25 ("provide me all the skills one
    // by one... so I can scroll down and accept or reject"). Each card is
    // still its own independent accept/reject action (never bundled into
    // one suggestion), just no longer gated behind resolving the previous
    // one first. (Previously queued them one-at-a-time via a
    // 'remainingSkillQueue' field revealed by a second effect as each prior
    // suggestion was resolved - removed since nothing queues anymore.)
    useEffect(() => {
        if (skillGapTriggeredRef.current) return;
        if (messages.some(m => m.id === 'skill-gap-intro')) { skillGapTriggeredRef.current = true; return; }
        if (!jobDescription || jobDescription.trim().length < 80) return;
        const currentSkills = flattenResumeSkills(state.resumeData.skills as any);
        const skillCategories = (state.resumeData.skills as any)?.categorized ?? [];
        if (skillCategories.length === 0) return; // nothing to add skills into yet

        skillGapTriggeredRef.current = true;

        fetch('/api/falood/skill-gap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobDescription,
                resumeSkills: currentSkills,
                skillCategories: skillCategories.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })),
                candidateId: candidateId || undefined,
            }),
        })
            .then(res => res.ok ? res.json() : { gaps: [] })
            .then(({ gaps }: { gaps: SkillGapItem[] }) => {
                if (!Array.isArray(gaps) || gaps.length === 0) return;
                const introMsg: ChatMessage = {
                    id: 'skill-gap-intro',
                    role: 'assistant',
                    content: `I compared this draft against the job description${candidateId ? ", your base resume, and your confirmed skills" : " and your base resume"}, and found ${gaps.length} skill${gaps.length > 1 ? 's' : ''} worth considering. Each is its own card below - scroll through and accept or reject them individually, in any order.`,
                    suggestions: gaps.map(buildSkillGapSuggestion),
                };
                setChatHistory([...messages, introMsg]);
            })
            .catch(() => { /* Non-fatal: the general auto-suggest effect above still runs regardless. */ });
    }, [jobDescription, messages, state.resumeData.skills, candidateId, setChatHistory]);

    return (
        <div className="flex flex-col h-full gap-2 relative">
            <div className="flex items-center justify-between px-1 pb-2 border-b">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-indigo-500" />
                    <h2 className="font-semibold text-sm">AI Copilot</h2>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                        {pendingSuggestionsCount} pending
                    </Badge>
                    <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleAcceptAll}
                        disabled={pendingSuggestionsCount === 0 || isTyping}
                    >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Accept all
                    </Button>
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
                                                <Card 
                                                    key={suggestion.id} 
                                                    onMouseEnter={() => setPreviewSuggestion(suggestion)}
                                                    onMouseLeave={() => setPreviewSuggestion(null)}
                                                    className={cn(
                                                    "border shadow-sm overflow-hidden transition-all",
                                                    suggestion.status === 'accepted' ? "opacity-50 bg-green-50/30 border-green-200" :
                                                        suggestion.status === 'rejected' ? "opacity-40 bg-red-50/30 border-red-100 grayscale" :
                                                            suggestion.status === 'failed' ? "bg-amber-50/30 border-amber-300" : ""
                                                )}>
                                                    <CardHeader className="p-3 pb-2 bg-muted/30 border-b flex flex-row items-center justify-between space-y-0">
                                                        <CardTitle className="text-sm leading-tight">{suggestion.title}</CardTitle>
                                                        {suggestion.status === 'accepted' && <Badge variant="outline" className="text-[10px] text-green-600 border-green-200 bg-green-50">Accepted</Badge>}
                                                        {suggestion.status === 'rejected' && <Badge variant="outline" className="text-[10px] text-red-600 border-red-200 bg-red-50">Rejected</Badge>}
                                                        {suggestion.status === 'failed' && <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">Couldn&apos;t apply</Badge>}
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
                                                        {suggestion.contextTitle && (
                                                            <div className="mb-2 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                                                                {suggestion.contextTitle}
                                                            </div>
                                                        )}
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
                                                                            if ('degree' in s && 'institution' in s) {
                                                                                return (
                                                                                    <div key={idx} className="flex flex-col gap-0.5 mt-1 mb-1">
                                                                                        <span className="font-semibold">{s.degree}</span>
                                                                                        <span className="text-muted-foreground">{s.institution}{s.location ? ` â€” ${s.location}` : ''}</span>
                                                                                        {s.graduationYear && <span className="text-muted-foreground">{s.graduationYear}</span>}
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

                                                    {suggestion.status === 'failed' && (
                                                        <p className="px-3 pb-2 text-[11px] text-amber-700">
                                                            Couldn&apos;t find this exact text in the resume (it may have already changed). You can retry, reject, or edit it manually.
                                                        </p>
                                                    )}

                                                    {(!suggestion.status || suggestion.status === 'pending' || suggestion.status === 'failed') && (
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
                                                                {suggestion.status === 'failed' ? 'Retry' : 'Accept Change'}
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
