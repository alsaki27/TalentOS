// Database abstraction layer.
// Currently wraps the Neon serverless driver.
// Can be swapped for a different driver (pg, hyperdrive, etc.) without changing consumers.

export { sql, query, queryOne, execute } from "./neon";

// Future: add transaction support if needed
// export { transaction } from "./neon";
