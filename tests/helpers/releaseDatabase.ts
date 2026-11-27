/**
 * Lets go of sessions.db so its directory can be removed, in the order that matters: the agent queue
 * worker first, because its timer reopens a handle that was just closed, then the handle itself.
 * Imported lazily so a test file can set IMA2_CONFIG_DIR before lib/db loads the config.
 */
export async function releaseDatabase(): Promise<void> {
  const [{ stopAgentQueueWorker }, { closeDb }] = await Promise.all([import("../../lib/agentQueueWorker.ts"), import("../../lib/db.ts")]);
  stopAgentQueueWorker();
  closeDb();
}
