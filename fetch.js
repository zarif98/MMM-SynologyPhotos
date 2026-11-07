// node-fetch v3 is ESM-only; dynamic import also works from CommonJS on Node 16.
const fetchModule = import("node-fetch");

module.exports = (...args) => fetchModule.then(({ default: fetch }) => fetch(...args));
