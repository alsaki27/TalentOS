import { parseResumeFields } from "./src/lib/resumeParsing";
async function main() {
  const text = "John Doe\njohn@example.com\nExperience\nSoftware Engineer at Google\nJune 2024 - Nov 2024\n- Did some coding.\n- Did some more coding.";
  try {
    const res = await parseResumeFields(text, text);
    console.log("Success:", JSON.stringify(res, null, 2).slice(0, 100));
  } catch (err) {
    console.error("Error from parseResumeFields:", err);
  }
}
main();
