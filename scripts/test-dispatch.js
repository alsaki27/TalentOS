require('dotenv').config({ path: '.env.local' });
const { getProviderForAutomation } = require('./.next/server/pages/api/job-ceo/dispatch.js') || {};

async function run() {
  try {
    const fetch = require('node-fetch');
    const res = await fetch('http://localhost:3000/api/job-ceo/dispatch', { method: 'POST' });
    const text = await res.text();
    console.log("Dispatch Response:", text);
  } catch (e) {
    console.log("Error:", e);
  }
}
run();
