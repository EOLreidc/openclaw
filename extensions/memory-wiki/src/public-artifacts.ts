import { listMemoryCorePublicArtifacts } from "../../memory-core/src/public-artifacts.js";
import {
  listActiveMemoryPublicArtifacts,
  type MemoryPluginPublicArtifact,
} from "openclaw/plugin-sdk/memory-host-core";
import type { OpenClawConfig } from "../api.js";

export async function listBridgeMemoryPublicArtifacts(params: {
  cfg: OpenClawConfig;
}): Promise<MemoryPluginPublicArtifact[]> {
  const activeArtifacts = await listActiveMemoryPublicArtifacts({ cfg: params.cfg });
  if (activeArtifacts.length > 0) {
    return activeArtifacts;
  }
  return await listMemoryCorePublicArtifacts({ cfg: params.cfg });
}
