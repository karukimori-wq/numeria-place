// Disposable NP PoC only. No unverified engine worker may share recovery ownership.
module.exports = function serverOnly(env) {
  const mode = env.MEDUSA_WORKER_MODE;
  if (mode !== undefined && mode !== 'server') {
    throw Error('NP_POC_SERVER_MODE_REQUIRED');
  }
  return 'server';
};
