import { TokSyncRepository } from "../repository";

const repo = new TokSyncRepository();
const user = repo.seedDevelopmentUser(process.env.TOKSYNC_DEV_USER || "demo");
repo.setPublicProfile(user.username, {
  enabled: true,
  showCost: true,
  showSourceBreakdown: false,
  showModelBreakdown: false,
  showWorkspaceBreakdown: false,
});
console.log(`Seeded TokSync user ${user.username}`);
