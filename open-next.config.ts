import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// TalentOS does not use a Cloudflare-backed incremental cache. Keep the
// adapter configuration explicit so CI never prompts to create this file.
export default defineCloudflareConfig({});
