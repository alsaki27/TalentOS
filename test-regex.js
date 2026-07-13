const text = "Here is the parsed resume:\n```json\n{\"skills\":[]}\n```";
const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
console.log(clean);
