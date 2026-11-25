export type ContractSignature =
  { type: "typed"; text: string } | { type: "drawn"; strokes: number[][][] };
export interface ContractSigningInput {
  signerName: string;
  signerEmail: string;
  signingDate: string;
  signature: ContractSignature;
}
export function validateContractSigning(
  body: Record<string, unknown>,
): ContractSigningInput {
  const signerName =
    typeof body.signerName === "string" ? body.signerName.trim() : "";
  const signerEmail =
    typeof body.signerEmail === "string"
      ? body.signerEmail.trim().toLowerCase()
      : "";
  const signingDate =
    typeof body.signingDate === "string" ? body.signingDate : "";
  if (
    signerName.length < 2 ||
    signerName.length > 160 ||
    /[\x00-\x1f\x7f]/.test(signerName)
  )
    throw new Error("Enter your full legal name.");
  if (
    signerEmail.length > 254 ||
    !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(signerEmail)
  )
    throw new Error("Enter a valid email address for your signed copy.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(signingDate) ||
    !Number.isFinite(Date.parse(signingDate)) ||
    new Date(signingDate).toISOString().slice(0, 10) !== signingDate ||
    Math.abs(Date.parse(signingDate) - Date.now()) > 2 * 86400000
  )
    throw new Error("Use your current local signing date.");
  if (body.signatureConsent !== true)
    throw new Error("Confirm your intention to sign electronically.");
  const raw = body.signature as ContractSignature | undefined;
  let signature: ContractSignature;
  if (
    raw?.type === "typed" &&
    typeof raw.text === "string" &&
    raw.text.trim() === signerName
  )
    signature = { type: "typed", text: signerName };
  else if (
    raw?.type === "drawn" &&
    Array.isArray(raw.strokes) &&
    raw.strokes.length <= 100
  ) {
    let count = 0,
      distance = 0;
    for (const stroke of raw.strokes) {
      if (!Array.isArray(stroke) || stroke.length < 2)
        throw new Error("Draw your signature.");
      for (let i = 0; i < stroke.length; i++) {
        const point = stroke[i];
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some(
            (n) =>
              typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1,
          )
        )
          throw new Error("Invalid signature drawing.");
        count++;
        if (i)
          distance += Math.hypot(
            point[0] - stroke[i - 1][0],
            point[1] - stroke[i - 1][1],
          );
      }
    }
    if (count < 4 || count > 5000 || distance < 0.05)
      throw new Error("Draw your signature.");
    signature = { type: "drawn", strokes: raw.strokes };
  } else
    throw new Error("Type your full legal name as your signature or draw it.");
  return { signerName, signerEmail, signingDate, signature };
}
export const escapeContractHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
