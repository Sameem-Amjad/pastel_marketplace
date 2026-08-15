/** Strings the liveness/readiness probes emit. Probe bodies are unwrapped (@SkipResponseWrapper). */
export const HealthResponseMessage = {
  success: {
    ALIVE: 'Service is alive.',
    READY: 'Service is ready to accept traffic.',
  },

  fail: {
    NOT_READY: 'Service is not ready to accept traffic.',
  },
} as const;
