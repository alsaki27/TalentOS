# Sample Output — Interview Prep Document (Golden Reference)

> Reference material for the Interview Prep Document plugin (see `../PLAN.md`).
> Transcribed verbatim (content + structure) from `samples/sample-output-prep-doc.pdf`,
> the human-approved 4-page output generated from `sample-job-description.md` +
> `sample-resume.md` using `master-prompt-v6.md`.
>
> **This file captures CONTENT structure only.** For the exact visual spec (fonts, point
> sizes, colors, margins, column-width ratios), see Section 20 of `master-prompt-v6.md` —
> that section is the literal, load-bearing formatting contract. The original PDF in
> `samples/sample-output-prep-doc.pdf` is the pixel-accurate ground truth; open it directly
> when implementing the DOCX renderer rather than relying on this transcription for layout.
>
> Every row below is a worked example of the tone, density, and word-count discipline the
> generator must reproduce for *any* job description + resume pair — not just this one.

---

## Header bar (appears on every page)

- Left cell (dark navy `#17324D`, white bold text): `ADNAN TARIF | NEWS CORP | DESKSIDE SUPPORT ANALYST`
- Right cell (medium blue `#2F5D7C`, white bold text): `PAGE {N} - {SECTION NAME}`

---

## PAGE 1 — 10-MINUTE INTERVIEW FLASH CARD

### INTERVIEW IDENTITY

> Experienced Tier 1/Tier 2 corporate IT support specialist with measurable service results across Windows/Mac, AD/Entra/M365, SCCM/MECM deployment, networking, AV, mobile devices, CMDB and escalation. Sound like an independent support IC: methodical, customer-focused, technically curious, and accountable through closure.

### MUST REMEMBER — COMPANY | ROLE | CV PROOF (3 equal columns)

| COMPANY FACTS | ROLE PRIORITIES | CV PROOF ANCHORS |
|---|---|---|
| Global Technology is a shared technology services model supporting News Corp businesses including Dow Jones, HarperCollins, New York Post and Realtor.com. | Own 1st/2nd-level incidents and requests through resolution and communicated closure. | 500+ users; Windows + Mac support. |
| News Corp operates across information/news, digital real estate and book publishing; primary markets include the U.S., Australia and U.K. | Troubleshoot Windows, Mac, apps, networking, AD, M365, Google suite, printers, VoIP/mobile and AV. | 45–60 Tier 1/Tier 2 incidents weekly. |
| Careers language: "Passionate. Principled. Purposeful." Use this as a cue for integrity, communication and customer service, not as a slogan to recite. | Image/deploy/maintain PCs and Macs; coordinate warranty/service vendors. | 95% SLA; 4.7/5 CSAT; 88% first-contact resolution. |
| FY2026 revenue was $9.03B (+7%); company says it continues a digital-first transformation. Mention only if useful to explain interest in a changing enterprise environment. | Prioritize a fast queue and know when/how to escalate to L3. | 150+ PC/Mac/mobile/peripheral assets deployed or maintained. |
| | Keep CMDB/asset records accurate; support pilots, training, documentation and process improvement. | 30+ KB articles -> 15% lower ticket-handling time. |
| | | UB: 300+ service requests; CV reports 60% fewer repeat incidents. |

*(3–5 company facts; 4–6 role priorities; 5–7 CV proof anchors — see word-count limits in `master-prompt-v6.md` §9.)*

### PROBABLE QUESTION MAP — ANSWER HOOK + STORY (3 equal columns)

| OPENING / FIT | BEHAVIORAL / EXPERIENCE | TECHNICAL / SCENARIO |
|---|---|---|
| Tell me about yourself -> "2+ years + cross-platform support + measurable service." | Difficult problem -> Story 2: isolate before escalating. | Login/MFA -> account -> lock/disable -> MFA -> license/group -> session/device -> validate. |
| Why News Corp? -> "Shared technology + exact hands-on overlap + growth/learning environment." | Competing priorities -> Story 1: impact -> urgency/SLA -> dependency -> communicate. | No network -> scope -> link/IP -> DNS -> VPN -> service/backend. |
| Why strong fit? -> "Core JD work is already familiar; gaps are learnable and I am honest about depth." | Difficult user -> Practice Story 4: acknowledge impact -> regain control -> update -> confirm closure. | Imaging -> assign -> provision -> secure -> patch -> validate -> CMDB -> handoff. |
| Why move? -> "More hands-on enterprise deskside scope and onsite user interaction." (Use only if true.) | Improvement -> Story 5/6: repeated pattern -> standardize -> result. | AV outage -> meeting continuity first -> known-good fallback -> root cause after. |
| | Collaboration/escalation -> Story 7: evidence package -> handoff -> retain ownership. | CMDB -> device/user/location/lifecycle updated during work, not later. |
| | Learning quickly -> Story 8: understand need -> documentation/lab -> validate -> document. | Escalation -> symptoms + scope + errors + tests + results; keep user ownership. |

### STORY MAP + GAPS + MUST FOLLOW (3 near-equal columns)

| 8 STORY LABELS | GAPS — WORD CAREFULLY | MUST FOLLOW |
|---|---|---|
| 1. High-volume queue: pressure, priority, service. | Google Workspace: M365 is stronger; apply same account/access/sync/service troubleshooting method. | Opening: 45–75 sec. Technical scenarios: ~60–90 sec. |
| 2. First-contact diagnosis: troubleshooting, ownership. | Adobe Creative Suite: no deep claim; troubleshoot install/update/profile/license/connectivity and use vendor/internal docs. | Behavioral: Hook -> S/T short -> ACTION largest -> Result. |
| 3. Endpoint deployment: SCCM, lifecycle, CMDB. | macOS Disk Utility: Mac support yes; exact Disk Utility depth only if personally true. | Say "I" for your actions; "we" only for team context. |
| 4. Difficult user: empathy, expectation setting. **PRACTICE.** | Depew onsite: confirm relocation/5-day onsite availability before interview. | For technical: clarify scope before touching anything. |
| 5. KB improvement: initiative, documentation. | | Escalation is not abandonment; retain communication/closure. |
| 6. Repeat-incident reduction: root cause, improvement. | | Stop after result. Let interviewer pull deeper detail. |
| 7. Vendor/L3 escalation: teamwork, follow-through. **PRACTICE.** | | Do not claim Google/Adobe/Disk Utility/management depth you cannot prove. |
| 8. Learn unfamiliar tool: adaptability. **PRACTICE.** | | |

### CLOSING REMINDER

> Cross-platform support + measurable service quality + structured troubleshooting + ticket ownership + honest learning agility.

---

## PAGE 2 — BEHAVIORAL + EXPERIENCE Q&A / STAR COACHING

**Instruction line:** `HOW TO ANSWER: HOOK -> S/T BRIEFLY -> ACTION (MOST DETAIL) -> RESULT -> STOP`

**Table — 4 columns** (~12% | ~23% | ~48% | ~17% width): QUESTION / TEST | HOOK + HOW TO ANSWER | MODEL / STAR EXAMPLE | FOLLOW-UP / COACH NOTE

| # | QUESTION / TEST | HOOK + HOW TO ANSWER | MODEL / STAR EXAMPLE | FOLLOW-UP / COACH NOTE |
|---|---|---|---|---|
| 1 | **Tell me about yourself.**<br>TESTS: Relevance, communication, confidence | "2+ years, cross-platform support, measurable service results." Present role + scale/metrics -> core technical scope -> UB foundation -> why this role. Keep it ~60 sec. | I'm an IT support specialist with a little over two years of corporate Tier 1 and Tier 2 support experience across deskside and remote environments. In my current role I support more than 500 Windows and Mac users and handle around 45 to 60 incidents each week while maintaining 95% SLA compliance, 4.7 out of 5 CSAT and 88% first-contact resolution. My work includes AD/Entra and Microsoft 365 administration, SCCM/MECM deployment, networking, mobile devices, AV and CMDB asset management. Before that at the University at Buffalo I handled in-person deskside support, imaging and network troubleshooting. This role is a strong match because it combines the same hands-on areas in a larger shared-technology environment. | "Which area are you strongest in?" Pick 2–3, then give one proof point. |
| 2 | **Tell me about a difficult technical problem you solved.**<br>TESTS: Diagnosis, independence, technical depth | "I isolate the layer before I escalate." Choose one TRUE incident. Explain symptom/scope, what you ruled out, why you tested each step, validation and documentation. | STAR example using CV framework: S: A user had a work-stopping issue that could have been account, endpoint, application or network related. T: Restore service without unnecessary handoff. A: Clarified the exact symptom and recent changes, reproduced where possible, separated account/device/app/network layers, tested the highest-probability causes, validated each result, then confirmed the fix with the user and documented it. R: This structured approach supports the 88% first-contact resolution reported in my current role. Replace the generic symptom with a real incident before the interview. | "What was the root cause?" You need a real root cause; do not bluff. |
| 3 | **Tell me about a time you had competing priorities.**<br>TESTS: Judgment, calm, SLA awareness | "Impact first, then urgency and dependency." Show what you deprioritized and why. Include communication with waiting users. | S: In a 500+ user environment I regularly manage 45–60 incidents a week. T: Keep urgent work moving without losing lower-priority requests. A: I separate work-stopping/access/security or multi-user issues from routine requests, consider SLA timing and workaround availability, acknowledge lower-priority users, set realistic ETAs, and escalate dependencies with troubleshooting already documented. R: I maintained 95% SLA compliance and 4.7/5 CSAT. | "What would outrank an executive request?" Answer by impact/security/site outage, not title alone. |
| 4 | **Tell me about a difficult or frustrated user.**<br>TESTS: Empathy, control, communication | "Acknowledge the impact, then make the next step clear." Do not argue. Separate emotion from technical problem. Keep user updated until closure. | PRACTICE STAR — adapt to a true case. S: A user was frustrated because an issue had interrupted work and they felt progress was too slow. T: Stabilize the interaction and move troubleshooting forward. A: I acknowledged the impact, restated the issue to confirm understanding, explained what I was checking in plain language, gave a realistic next update time, worked the technical steps, and followed up after the fix. R: The user regained service and understood what had happened and what to expect next. | "What if they stay angry?" Stay calm, set boundaries, involve manager only when behavior/impact requires it. |
| 5 | **Tell me about a mistake or failure.**<br>TESTS: Accountability, maturity | "Own it, correct it, prevent recurrence." Use a TRUE example. Pick a recoverable mistake, not a fake weakness. Show control change. | Answer frame: S/T: Briefly state the mistake and impact. A: Say what YOU did immediately to contain/correct it, who you informed, and what process/documentation/check you changed. R: Explain what improved and what you learned. Do not use an invented metric. If you cannot name a real example, prepare one before the interview. | "Why did it happen?" Give a root cause, not an excuse. |
| 6 | **Tell me about an improvement you made.**<br>TESTS: Initiative, repeatability, documentation | "If it repeats, standardize it." Use Story 5 or 6. Explain pattern -> action -> adoption -> result. | S: Repeated support patterns were creating inconsistent handling. T: Make troubleshooting more repeatable. A: I authored and maintained 30+ knowledge-base articles, troubleshooting guides and standard procedures based on recurring support needs. R: The CV reports a 15% reduction in average ticket-handling time. At UB I also analyzed recurring issues and standardized troubleshooting, contributing to a reported 60% reduction in repeat incidents. | "How did you decide what to document?" Frequency, impact, repeatability and knowledge gaps. |
| 7 | **Tell me about collaborating with L3 or a vendor.**<br>TESTS: Teamwork, escalation quality, ownership | "Escalation is a controlled handoff, not abandonment." Show what evidence you supplied and how you retained user ownership. | PRACTICE STAR — adapt to a real escalation. S: A hardware or service issue required permissions or vendor action outside Tier 2. T: Move it quickly without making the user repeat the story. A: I documented symptoms, scope, errors, steps already tested and results; contacted the correct L3/vendor path; coordinated replacement or advanced troubleshooting; updated the user; and confirmed final closure. R: The next team could act faster because the escalation was complete, and the user still had one accountable contact. | "When do you stop troubleshooting?" When next action requires ownership/access outside scope or time/business risk makes escalation more appropriate. |
| 8 | **Tell me about learning a new tool or technology quickly.**<br>TESTS: Learning agility, self-direction | "Understand the task first; then learn the minimum needed to solve it safely." Show documentation, safe testing, asking focused questions and capturing what you learned. | PRACTICE STAR — adapt to a true example. S: I needed to support a feature or tool I had limited prior exposure to. T: Resolve the user need without pretending expertise. A: I clarified the required outcome, checked internal/vendor documentation, reproduced the issue safely, compared expected vs actual behavior, asked a focused question of a more experienced teammate when needed, validated the fix, and documented the learning. R: The issue was resolved and the knowledge became reusable. | "What tool?" Name a real tool you actually learned. |
| 9 | **Why should we hire you / what makes you a strong fit?**<br>TESTS: Evidence-based fit | "The core work is already familiar; I can contribute quickly and ramp honestly on gaps." Connect 3 JD priorities to 3 proof points. Do not list every tool. | The strongest match is in the day-to-day work: Tier 1/Tier 2 ticket ownership, Windows and Mac support, AD/Entra/M365, endpoint deployment, network and peripheral troubleshooting, AV, asset management and escalation. I also have measurable service evidence: 95% SLA, 4.7/5 CSAT and 88% first-contact resolution. I would be transparent that Google Workspace and Adobe are not my deepest platforms, but the troubleshooting method and enterprise support habits transfer directly. | "What would you need to learn first?" Say company-specific tooling/processes and the identified gaps. |

**Footer:** `STORY MEMORY: 1 Queue | 2 Diagnose | 3 Deploy | 4 Difficult user (practice) | 5 KB | 6 Repeat issues | 7 L3/vendor (practice) | 8 Learn tool (practice). Practice examples must be replaced/adapted to a comparable true incident before presenting them as personal history.`

---

## PAGE 3 — TECHNICAL QUESTIONS + STEP-BY-STEP ANSWERS

**Instruction line:** `TECHNICAL ANSWER RULE: CLARIFY SCOPE -> ISOLATE LAYER -> TEST SAFELY -> VALIDATE -> DOCUMENT -> ESCALATE WITH EVIDENCE`

**Table — 4 columns** (~12% | ~18% | ~51% | ~19% width): QUESTION | WHAT THEY TEST / HOOK | STEP-BY-STEP ANSWER | CV EVIDENCE

| # | QUESTION | WHAT THEY TEST / HOOK | STEP-BY-STEP ANSWER | CV EVIDENCE |
|---|---|---|---|---|
| 1 | User cannot log in after password/MFA change. | Identity troubleshooting — "Separate account, MFA, session and device." | Confirm exact error and scope. Check AD/Entra account state, lockout/disablement, password status, MFA registration, relevant license/group if applicable, stale sessions/cached credentials and network reachability. Reset/re-register only when justified. Test sign-in, confirm access, document change. Escalate backend/permissions issues with evidence. | AD/Entra, MFA, provisioning, password resets. |
| 2 | Windows/Mac cannot reach corporate resources. | Network isolation — "Scope first; endpoint vs network." | Determine one device/user vs wider impact. Check Wi-Fi/Ethernet link, IP configuration, gateway/DNS reachability, VPN state, recent changes and service status. Compare another device/network when useful. Isolate endpoint config, DHCP/DNS, VPN, wireless, account or backend dependency. Restore or escalate with test results. | TCP/IP, DNS, DHCP, Wi-Fi, VPN, Windows/macOS. |
| 3 | Walk me through imaging/deploying a new endpoint. | Lifecycle discipline — "Assign -> provision -> secure -> patch -> validate -> CMDB -> handoff." | Confirm user/device and build standard. Use approved imaging/provisioning workflow (SCCM/MECM/Autopilot where applicable), install required apps/security, join/enroll, patch, validate sign-in/network/peripherals, record asset/user/location in CMDB, complete handoff. State PC/Mac-specific tooling only to the level actually used. | 150+ assets; SCCM/MECM; Autopilot; CMDB. |
| 4 | SCCM deployment fails. What do you check? | Endpoint management reasoning — "Determine whether failure is content, client, network, policy or device state." | Confirm device is reachable and properly discovered/assigned; verify SCCM client health and policy; check available disk/power/network; confirm content/package availability and distribution; review relevant status/error/logs; retry only after cause is understood; document and escalate infrastructure/distribution issues with evidence. | SCCM/MECM deployment experience; exact log depth should match actual experience. |
| 5 | Outlook/M365 user cannot send or sync mail. | Application + identity — "Separate client, account, network and service." | Check scope/service status, network, account sign-in/license, mailbox access via web if appropriate, Outlook connection/profile/cache/add-ins/recent changes, and authentication prompts. Recreate profile only when justified. Validate send/receive; document. Escalate mailbox/service-side issues with symptoms and tests. | Microsoft 365, Outlook, Exchange Online, Entra/AD. |
| 6 | Network printer is unavailable. | Peripheral + network — "Device, queue, network, driver." | Check whether one user or all users are affected. Verify printer power/status/IP/network reachability, correct queue, stuck jobs, driver, default printer and print service. Test from another device. Clear/restart only when safe. If device/network hardware fault, capture evidence and coordinate replacement/vendor support. | Network printers; TCP/IP; hardware replacement. |
| 7 | Conference room fails minutes before a meeting. | AV + prioritization — "Meeting continuity first; root cause second." | Treat as high impact. Identify whether display, audio, camera/mic, cable/dock, room PC, user laptop or meeting app is failing. Use a known-good cable/device or fallback room/laptop path. Get meeting functional first; communicate status; then investigate recurring cause and document after the meeting. | Conference-room AV support. |
| 8 | Device is very slow. How do you troubleshoot? | Performance diagnosis — "Define when/where it is slow, then check resource, storage, startup and security." | Clarify all apps vs one app and when it began. Check CPU/memory/disk utilization, free space, startup processes, updates/reboot status, security scan/Defender state, network dependency and recent software changes. Compare symptoms after controlled steps. Avoid random cleanup tools. Validate performance and document cause. | Windows 10/11, macOS, Defender/endpoint support. |
| 9 | Remote user cannot connect to VPN. | Remote support — "Internet first, then client/authentication, then corporate reachability." | Confirm general internet access, exact VPN error, account/MFA state, client version/configuration, date/time, recent password change, network restrictions and service status. Test alternate network if appropriate. Avoid changing multiple variables at once. Validate internal resource access after connection. | VPN, remote support, MFA. |
| 10 | How do you decide when to escalate to L3/vendor? | Judgment + ownership — "Escalate when the next safe action needs ownership/access outside Tier 2 or time risk is rising." | First establish scope and complete reasonable Tier 2 tests. Escalate for privileged backend changes, infrastructure faults, vendor warranty/replacement, product defects or business-critical incidents where continued local testing adds delay/risk. Package symptoms, scope, errors/logs, steps and results. Continue user updates and confirm closure. | L3/vendor coordination; escalation ownership. |
| 11 | Why does CMDB accuracy matter and when do you update it? | Operational discipline — "Asset data is part of the support work, not admin afterthought." | CMDB should reflect device identity, assigned user, location, status and lifecycle. Update during deployment, move, replacement, loaner/return and retirement. Cross-check serial/asset details before closure. Accurate data supports support history, inventory, replacement planning and accountability. | Asset inventory, hardware lifecycle, CMDB. |
| 12 | How would you support Google Workspace or Adobe if unfamiliar? | Learning agility + honesty — "Be honest about platform depth; strong on troubleshooting method." | Acknowledge M365 is stronger. Clarify exact symptom. Check install/version, account/access/license, profile/configuration, browser/client behavior, sync, network/service dependency and recent changes. Use internal/vendor documentation, reproduce safely, document findings and escalate product-specific defects with evidence. Do not pretend deep admin experience. | M365/enterprise app support; gap bridge. |
| 13 | How do you support iOS/Android mobile devices? | Mobile endpoint support — "Start with enrollment/account/connectivity/app scope." | Clarify device/OS/version and whether issue is cellular, Wi-Fi, mail/app access, account/MFA or device management. Check connectivity, account state, app/client settings, updates and approved enrollment/profile requirements. Protect user data; avoid destructive reset until backup/policy and escalation path are clear. | iOS/Android and mobile device support. |
| 14 | What would you check on a Mac startup/storage issue? | Mac depth / Disk Utility gap — "Differentiate startup, filesystem/storage and user-profile symptoms." | Clarify exact startup/storage behavior, free space and recent changes. Use built-in diagnostics/approved tools only to the depth you know, review disk/storage health symptoms, safe boot/recovery options if within procedure, and protect data before repair steps. State Disk Utility experience honestly; escalate when filesystem/hardware repair exceeds your depth. | macOS support; Disk Utility depth must be truthful. |

---

## PAGE 4 — NEWS CORP/JD-SPECIFIC + GAPS + CLOSING

### Block A — COMPANY / JD-SPECIFIC PROBABLE QUESTIONS (3 columns: ~24% | ~22% | ~54%)

| # | QUESTION | WHY THEY MAY ASK | HOW TO ANSWER / MODEL NOTES |
|---|---|---|---|
| 1 | You receive a work-stopping login issue, a conference-room failure before a meeting, and several normal requests at once. How do you prioritize? | JD explicitly requires triage, AV and ticket ownership. | Hook: "Business impact, time sensitivity, users affected, workaround." Example: acknowledge all tickets; stabilize meeting if imminent/high impact; parallel-check access issue if security/work-stopping; communicate ETAs; document; pull in teammate/L3 if justified. Show that priority is based on impact, not job title alone. |
| 2 | How would you support users across different News Corp business units in a shared-services model? | Global Technology supports several business units. | Hook: "Consistent standards, but communicate to the user's context." Use approved process/KB, capture business impact, avoid assumptions, document clearly enough for another team to continue, protect data/access boundaries, and keep the user informed through resolution. |
| 3 | The JD says you may pilot/test new hardware or software. How would you approach a pilot? | They want controlled change, not just break/fix. | Define success criteria and target users; understand support/security dependencies; test common workflows and failure cases; record issues; gather user feedback; communicate limitations; document rollback/escalation path; feed results into launch documentation/training. |
| 4 | How would you train a new employee or explain an application to a nontechnical user? | JD includes application training/new employee support. | Start from the user's task, not features. Demonstrate the minimum workflow, let them perform it, give one short reference/KB link, confirm understanding, and document repeated confusion points that may need better onboarding material. |
| 5 | A warranty laptop has recurring hardware failure. What do you do? | JD includes vendor/service-provider coordination. | Confirm issue and rule out software/config causes; capture serial/warranty/diagnostic evidence; protect user data; arrange loaner/workaround if needed; open vendor case with complete details; update CMDB during replacement; validate user setup and close loop. |
| 6 | You are asked to create a desktop communication about a change. What makes it effective? | JD includes communications/announcements. | State what is changing, who is affected, when, user action required, expected impact, support/contact path and any workaround. Use plain language and test instructions from a user perspective before sending. |
| 7 | How would you improve technical documentation? | JD explicitly asks to manage/improve documentation. | Prioritize high-frequency/high-impact issues, write clear prerequisites and decision steps, include escalation criteria, validate with another technician, update after product/process changes, and remove duplicate/outdated guidance. Use 30+ KB articles/15% handling-time result as evidence. |

### Block B — OPENING ANSWERS - MODEL THE STRUCTURE, THEN SPEAK NATURALLY (2 columns: ~38% | ~62%)

| QUESTION | MODEL ANSWER |
|---|---|
| Tell me about yourself | I'm an IT support specialist with a little over two years of corporate Tier 1 and Tier 2 support experience across deskside and remote environments. In my current role I support 500+ Windows and Mac users and handle roughly 45–60 incidents per week while maintaining 95% SLA compliance, 4.7/5 CSAT and 88% first-contact resolution. My work covers AD/Entra/Microsoft 365, SCCM/MECM deployment, networking, mobile devices, AV and CMDB asset management. Before that at the University at Buffalo I handled in-person deskside support, imaging and network troubleshooting. News Corp stands out because the role combines the same hands-on areas in a larger shared-technology environment. |
| Why News Corp? | The role is attractive because Global Technology supports several News Corp businesses through a shared-services model, so good support, documentation and communication have impact beyond one local team. The JD also lines up closely with what I already do across Windows, Mac, identity, endpoint deployment, networking, AV and asset management. News Corp is also continuing a digital-first transformation, so it looks like an environment where I can contribute with my current foundation while continuing to learn new platforms and processes. |
| Why are you a strong fit? | The core responsibilities are already familiar to me: Tier 1/Tier 2 ticket ownership, Windows and Mac support, AD/Entra/Microsoft 365, endpoint deployment, networking and peripherals, AV, asset management and escalation. I can also point to measurable service results such as 95% SLA, 4.7/5 CSAT and 88% first-contact resolution. Where I have less direct depth, such as Google Workspace or Adobe, I would be transparent and use the same structured troubleshooting and learning approach. |

### Block C — GAP HANDLING + QUESTIONS TO ASK + FINAL CHECK (3 columns, GAPS widest)

| GAPS — EXACT WORDING | TOP QUESTIONS TO ASK | FINAL CHECK |
|---|---|---|
| **Google Workspace:** "It is not the primary platform shown on my CV. My closest experience is M365 and enterprise account/access support. I would apply the same structured method while learning News Corp's specific workflows." | What are the most common endpoint or user-support issues at the Depew site? | Sound like an experienced support IC, not a manager. |
| **Adobe:** "Not my deepest product area. I can troubleshoot install/update, permissions, profile/config, licensing/connectivity symptoms and use internal/vendor resources for product-specific defects." | How is ownership divided between local deskside support and centralized third-level teams? | Give method + judgment + communication + result. |
| **macOS Disk Utility:** "I support macOS, but I would describe Disk Utility only to the level I have personally used it." | What should this person be able to handle independently by the end of 90 days? | For every story, know what YOU did. |
| **Onsite Depew:** candidate must confirm. If true, state clearly that five-day onsite is acceptable and relocation/commute plan is understood. | Backup: Are there endpoint refresh, pilot or collaboration-tool changes the team is currently supporting? | For technical answers, explain sequence, not tool names. |
| | | Do not overclaim gaps. |
| | | Close the loop: validate, document, communicate. |

### FINAL CLOSING

> "The core work here is very close to what I have been doing: cross-platform Tier 1/Tier 2 support, endpoint deployment, identity/M365, network troubleshooting, AV and asset management. I am disciplined about troubleshooting, documentation, escalation and user communication, and I would be ready to contribute in those areas while continuing to expand in News Corp's environment."
