"use client";

interface SequenceStep {
  step_number: number;
  template_id: string;
  delay_hours: number;
  send_time?: string | null;
  condition?: string | null;
}

interface SequenceBuilderProps {
  steps: SequenceStep[];
  onChange: (steps: SequenceStep[]) => void;
  templates: { id: string; name: string; subject: string }[];
}

export default function SequenceBuilder({ steps, onChange, templates }: SequenceBuilderProps) {
  function addStep() {
    const nextStep: SequenceStep = {
      step_number: steps.length + 1,
      template_id: templates[0]?.id ?? "",
      delay_hours: 24,
      send_time: null,
      condition: null,
    };
    onChange([...steps, nextStep]);
  }

  function updateStep(index: number, patch: Partial<SequenceStep>) {
    const next = steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  }

  function removeStep(index: number) {
    const next = steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_number: i + 1 }));
    onChange(next);
  }

  function moveStep(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= steps.length) return;
    const next = [...steps];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    onChange(next.map((s, i) => ({ ...s, step_number: i + 1 })));
  }

  function formatTimeline(stepIndex: number) {
    if (stepIndex === 0) return "Immediately";
    const totalHours = steps.slice(0, stepIndex + 1).reduce((sum, s) => sum + (s.delay_hours || 0), 0);
    if (totalHours < 24) return `+${totalHours} hours`;
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return hours > 0 ? `+${days}d ${hours}h` : `+${days}d`;
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {steps.map((step, index) => (
          <div
            key={index}
            className="card"
            style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "start" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
              <span className="badge" style={{ minWidth: 28, textAlign: "center" }}>{step.step_number}</span>
              <span className="muted" style={{ fontSize: 11 }}>{formatTimeline(index)}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field-group" style={{ marginBottom: 0 }}>
                <label>Template</label>
                <select
                  value={step.template_id}
                  onChange={(e) => updateStep(index, { template_id: e.target.value })}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="field-group" style={{ marginBottom: 0 }}>
                <label>Delay (hours)</label>
                <input
                  type="number"
                  min={0}
                  value={step.delay_hours}
                  onChange={(e) => updateStep(index, { delay_hours: parseInt(e.target.value || "0", 10) })}
                />
              </div>
              <div className="field-group" style={{ marginBottom: 0 }}>
                <label>Send Time (optional)</label>
                <input
                  type="time"
                  value={step.send_time ?? ""}
                  onChange={(e) => updateStep(index, { send_time: e.target.value || null })}
                />
              </div>
              <div className="field-group" style={{ marginBottom: 0 }}>
                <label>Condition (optional)</label>
                <select
                  value={step.condition ?? ""}
                  onChange={(e) => updateStep(index, { condition: e.target.value || null })}
                >
                  <option value="">— None —</option>
                  <option value="opened">Previous opened</option>
                  <option value="not_opened">Previous not opened</option>
                  <option value="replied">Previous replied</option>
                  <option value="not_replied">Previous not replied</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button
                className="btn-compact"
                disabled={index === 0}
                onClick={() => moveStep(index, -1)}
                title="Move up"
              >
                ↑
              </button>
              <button
                className="btn-compact"
                disabled={index === steps.length - 1}
                onClick={() => moveStep(index, 1)}
                title="Move down"
              >
                ↓
              </button>
              <button className="btn-compact btn-danger" onClick={() => removeStep(index)} title="Remove step">
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className="btn-primary" onClick={addStep} style={{ marginTop: 12 }}>
        + Add Step
      </button>

      {steps.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <strong style={{ fontSize: 13 }}>Estimated Timeline</strong>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {steps.map((_, index) => (
              <div key={index} style={{ fontSize: 13 }}>
                <span className="badge" style={{ marginRight: 8 }}>{index + 1}</span>
                <span className="muted">{formatTimeline(index)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
