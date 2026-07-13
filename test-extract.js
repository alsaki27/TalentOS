function extractJson(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match) {
    return match[1].trim();
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  let firstIdx = -1;
  let lastIdx = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    firstIdx = firstBrace;
    lastIdx = text.lastIndexOf('}');
  } else if (firstBracket !== -1) {
    firstIdx = firstBracket;
    lastIdx = text.lastIndexOf(']');
  }
  if (firstIdx !== -1 && lastIdx !== -1 && lastIdx > firstIdx) {
    return text.substring(firstIdx, lastIdx + 1).trim();
  }
  return text.trim();
}

console.log(extractJson("Here is the JSON:\n{\"test\": 123}\nHope that helps!"));
console.log(extractJson("```json\n{\"test\": 456}\n```"));
console.log(extractJson("Here is the JSON:\n```\n{\"test\": 789}\n```"));
