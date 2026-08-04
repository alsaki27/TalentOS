import { dispatchNextJobCeoWork } from './src/server/services/jobCeoService';
import { Pool } from '@neondatabase/serverless';

async function testDispatch() {
  try {
    console.log("Calling dispatchNextJobCeoWork()...");
    const res = await dispatchNextJobCeoWork();
    console.log("RESULT:", res);
  } catch (err) {
    console.error("ERROR:", err);
  }
}

testDispatch();
