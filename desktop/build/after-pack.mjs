/** electron-builder afterPack: prove the bundle is runnable, then sign loose Mach-O sidecars. */
import signExtraBinaries from './sign-extra-binaries.mjs';
import verifyBundledDependencies from './verify-bundled-deps.mjs';

export default async function afterPack(context) {
  verifyBundledDependencies(context);
  await signExtraBinaries(context);
}
