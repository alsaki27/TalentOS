"use client";

import { INTERVIEW_TIME_ZONES, type InterviewTimeZone } from "@/lib/easternTime";

interface Props {
  id: string;
  value: InterviewTimeZone;
  onChange: (timeZone: InterviewTimeZone) => void;
  useArizonaTime: boolean;
  onUseArizonaTimeChange: (useArizonaTime: boolean) => void;
}

export default function InterviewTimeZoneField({
  id,
  value,
  onChange,
  useArizonaTime,
  onUseArizonaTimeChange,
}: Props) {
  return (
    <div className="field-group">
      <label htmlFor={id}>Time zone</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as InterviewTimeZone)}>
        {INTERVIEW_TIME_ZONES.map((zone) => (
          <option key={zone.value} value={zone.value}>{zone.label}</option>
        ))}
      </select>
      {value === "America/Denver" && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, fontSize: 12, fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={useArizonaTime}
            onChange={(event) => onUseArizonaTimeChange(event.target.checked)}
            aria-label="Use Arizona time, Mountain Standard Time year-round"
            style={{ width: 16, height: 16, margin: "1px 0 0" }}
          />
          <span>Use Arizona time (MST year-round, for most of Arizona)</span>
        </label>
      )}
    </div>
  );
}
