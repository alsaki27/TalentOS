import { NextRequest, NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { encryptCandidateSsnLast4 } from "@/server/privacy/candidateSsnCrypto";
import { validateContractSigning } from "@/lib/contractSignature";
import { saveSignedContract, processContractDeliveries } from "@/server/services/contractSigningService";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { currentTerms } from "@/lib/candidateAgreementTerms";
import { CANDIDATE_PRIVACY_NOTICE_VERSION } from "@/lib/candidatePortalAgreementVersion";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const { context, response } = await requireCurrentCandidate({ allowIncompleteOnboarding: true });
  if (response) return response;

  const terms = currentTerms(context.candidate);
  const required = !context.candidate.has_contract && !context.candidate.onboarding_complete;
  return NextResponse.json({
    required,
    candidateName: context.candidate.name,
    agreementVersion: terms.version,
    privacyNoticeVersion: CANDIDATE_PRIVACY_NOTICE_VERSION,
    ...(required ? { agreementText: terms.text, agreementRuns: terms.runs } : {}),
  }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentCandidate({ allowIncompleteOnboarding: true });
  if (response) return response;
  if (context.candidate.has_contract || context.candidate.onboarding_complete) {
    return NextResponse.json({ ok: true, alreadyCompleted: true }, { headers: NO_STORE });
  }

  const reader = req.body?.getReader();
  if (!reader) return NextResponse.json({error:"Submit your signature."},{status:400,headers:NO_STORE});
  const chunks:Uint8Array[]=[];let size=0;
  for (;;) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>500000){await reader.cancel();return NextResponse.json({error:"Signature is too large."},{status:413,headers:NO_STORE});}chunks.push(value); }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{body=null;}
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Submit the required onboarding choices." }, { status: 400, headers: NO_STORE });
  }
  const terms = currentTerms(context.candidate);
  if (body.agreementVersion !== terms.version || body.privacyNoticeVersion !== CANDIDATE_PRIVACY_NOTICE_VERSION) {
    return NextResponse.json({ error: "The agreement has changed. Reload it and review the current version." }, { status: 409, headers: NO_STORE });
  }
  if (body.termsAccepted !== true || body.agreementScrolledToEnd !== true || body.dataProcessingConsent !== true) {
    return NextResponse.json({ error: "Both acknowledgments are required to continue." }, { status: 400, headers: NO_STORE });
  }
  if (typeof body.hasSsn !== "boolean") {
    return NextResponse.json({ error: "Choose Yes or No for the Social Security Number question." }, { status: 400, headers: NO_STORE });
  }

  let signing;
  try { signing = validateContractSigning(body); }
  catch(error) { return NextResponse.json({error: error instanceof Error ? error.message : "Complete the signature fields."},{status:400,headers:NO_STORE}); }
  let encryptedLast4: string | null = null;
  if (body.hasSsn) {
    const last4 = typeof body.ssnLast4 === "string" ? body.ssnLast4 : "";
    if (!/^\d{4}$/.test(last4)) {
      return NextResponse.json({ error: "Enter exactly the last four digits of your SSN." }, { status: 400, headers: NO_STORE });
    }
    try {
      encryptedLast4 = await encryptCandidateSsnLast4(last4, context.candidateId);
    } catch {
      return NextResponse.json({ error: "Secure SSN storage is not configured. Contact the Skarion team." }, { status: 503, headers: NO_STORE });
    }
  } else if (body.ssnLast4 !== undefined && body.ssnLast4 !== "") {
    return NextResponse.json({ error: "Do not submit SSN digits when No is selected." }, { status: 400, headers: NO_STORE });
  }

  try {
    const saved = await saveSignedContract(context.candidateId, signing, body.hasSsn, encryptedLast4, terms);
    backgroundDispatch(processContractDeliveries());
    return NextResponse.json({ ok: true, contractId: saved.id, copyEmail: saved.signer_email, emailDelivery: "queued" }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Error && error.message === "Agreement changed") return NextResponse.json({ error: "The agreement has changed. Reload and review the current terms." }, { status: 409, headers: NO_STORE });
    return NextResponse.json({ error: "Could not save onboarding. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
