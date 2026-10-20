// Include the real loopback HTTP consumer contract in the standard test glob.
await import(new URL('./task-verification-policy-consumer-http.test.mjs', import.meta.url).href);
