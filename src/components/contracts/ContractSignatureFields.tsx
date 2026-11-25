"use client";
import { useRef, useState, type PointerEvent } from "react";
import type { ContractSignature } from "@/lib/contractSignature";
export interface SignatureFieldsValue {
  signerName: string;
  signerEmail: string;
  signingDate: string;
  signature: ContractSignature;
  signatureConsent: boolean;
}
export function ContractSignatureFields({
  value,
  onChange,
  disabled,
}: {
  value: SignatureFieldsValue;
  onChange: (v: SignatureFieldsValue) => void;
  disabled: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    current = useRef<number[][] | null>(null);
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    ];
  }
  function finish() {
    if (!current.current) return;
    const stroke = current.current;
    current.current = null;
    if (stroke.length < 2) return;
    const strokes =
      value.signature.type === "drawn" ? value.signature.strokes : [];
    onChange({
      ...value,
      signature: { type: "drawn", strokes: [...strokes, stroke] },
    });
  }
  return (
    <fieldset
      disabled={disabled}
      className="portal-contract-signature"
      data-recorder-ignore
    >
      <legend>Sign your agreement</legend>
      <div className="portal-onboarding-field">
        <label htmlFor="signer-name">Full legal name</label>
        <input
          id="signer-name"
          autoComplete="name"
          required
          maxLength={160}
          value={value.signerName}
          onChange={(e) => onChange({ ...value, signerName: e.target.value })}
        />
      </div>
      <div className="portal-onboarding-field">
        <label htmlFor="signer-email">Email for your signed copy</label>
        <input
          id="signer-email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={value.signerEmail}
          onChange={(e) => onChange({ ...value, signerEmail: e.target.value })}
        />
        <small>A PDF copy will be emailed here and to info@skarion.com.</small>
      </div>
      <div className="portal-onboarding-field">
        <label htmlFor="signing-date">Signing date</label>
        <input
          id="signing-date"
          type="date"
          required
          value={value.signingDate}
          onChange={(e) => onChange({ ...value, signingDate: e.target.value })}
        />
      </div>
      <div style={{ display: "flex", gap: 12, margin: "18px 0" }}>
        {(["typed", "drawn"] as const).map((type) => (
          <button
            key={type}
            type="button"
            className="portal-btn portal-btn-secondary"
            aria-pressed={mode === type}
            onClick={() => {
              setMode(type);
              current.current = null;
              onChange({
                ...value,
                signature:
                  type === "typed" ? { type, text: "" } : { type, strokes: [] },
              });
              canvas.current?.getContext("2d")?.clearRect(0, 0, 1000, 300);
            }}
          >
            {type === "typed" ? "Type signature" : "Draw signature"}
          </button>
        ))}
      </div>
      {mode === "typed" ? (
        <div className="portal-onboarding-field">
          <label htmlFor="typed-signature">
            Type your full legal name as your signature
          </label>
          <input
            id="typed-signature"
            maxLength={160}
            required
            style={{ fontFamily: "cursive", fontSize: 28 }}
            value={value.signature.type === "typed" ? value.signature.text : ""}
            onChange={(e) =>
              onChange({
                ...value,
                signature: { type: "typed", text: e.target.value },
              })
            }
          />
        </div>
      ) : (
        <div>
          <p>
            Draw with your mouse, finger, or stylus. You can use the typed
            option instead.
          </p>
          <canvas
            ref={canvas}
            width={1000}
            height={300}
            aria-label="Draw signature"
            style={{
              width: "100%",
              height: "auto",
              border: "1px solid #98aca1",
              borderRadius: 8,
              touchAction: "none",
              background: "white",
            }}
            onPointerDown={(e) => {
              if (disabled) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              current.current = [point(e)];
            }}
            onPointerMove={(e) => {
              if (
                disabled ||
                !current.current ||
                current.current.length >= 1000
              )
                return;
              const next = point(e),
                previous = current.current.at(-1)!;
              current.current.push(next);
              const ctx = e.currentTarget.getContext("2d");
              if (ctx) {
                ctx.strokeStyle = "#173b34";
                ctx.lineWidth = 4;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(previous[0] * 1000, previous[1] * 300);
                ctx.lineTo(next[0] * 1000, next[1] * 300);
                ctx.stroke();
              }
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
          />
          <button
            type="button"
            className="portal-btn portal-btn-secondary"
            onClick={() => {
              current.current = null;
              canvas.current?.getContext("2d")?.clearRect(0, 0, 1000, 300);
              onChange({ ...value, signature: { type: "drawn", strokes: [] } });
            }}
          >
            Clear signature
          </button>
        </div>
      )}
      <label className="portal-onboarding-checkbox">
        <input
          type="checkbox"
          required
          checked={value.signatureConsent}
          onChange={(e) =>
            onChange({ ...value, signatureConsent: e.target.checked })
          }
        />
        <span>
          I intend this typed or drawn signature to sign the agreement
          electronically, and authorize delivery of the signed PDF to the email
          above and info@skarion.com.
        </span>
      </label>
    </fieldset>
  );
}
