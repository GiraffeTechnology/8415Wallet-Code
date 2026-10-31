/** Persisted CA bindings supersede configuration, including explicit empty unbinding. */
export function caBindingsFor(user, credential) {
  const present = credential != null && Object.hasOwn(credential, 'caBindings');
  const overlay = credential?.caBindings;
  if (present && (!overlay || typeof overlay !== 'object' || Array.isArray(overlay) ||
      Object.keys(overlay).length !== 2 || overlay.version !== 1 || !Object.hasOwn(overlay, 'fingerprints')))
    throw new Error('AUTH_CA_STATE_REFUSED');
  const values = !present ? user?.caFingerprints ?? [] : overlay.fingerprints;
  if (!Array.isArray(values) || values.some(v => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) ||
      new Set(values).size !== values.length) throw new Error('AUTH_CA_STATE_REFUSED');
  return [...values];
}
