import { parseResumeFields } from "./src/lib/resumeParsing";

async function main() {
    try {
        const rawText = "John Doe\njohn@example.com\nSoftware Engineer with 5 years experience in React and Node.js.\nExperience:\nGoogle\nSoftware Engineer\n2020 - Present\n- Built things";
        console.log("Parsing...");
        const result = await parseResumeFields(rawText);
        console.log("Success:", result.experience.length > 0);
    } catch (e) {
        console.error("ERROR:", e);
    }
}
main();
