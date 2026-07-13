const text = "Here is the parsed resume:\n```json\n{\"skills\":[]}\n```\nHope this helps!";
let clean = text;
const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
if (match) {
  clean = match[1];
} else {
  clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
console.log(clean);
