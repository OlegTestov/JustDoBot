import type {
  HealthStatus,
  ICollector,
  IMemoryProvider,
  PluginConfig,
} from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";

export interface VaultCollectedData {
  recentlyModified: Array<{ title: string; file_path: string; indexed_at: string }>;
}

export class VaultChangesCollector implements ICollector {
  name = "vault-changes-collector";
  version = "1.0.0";
  type = "vault" as const;

  constructor(private database: IMemoryProvider) {}

  async init(_config: PluginConfig): Promise<void> {}

  async collect(): Promise<VaultCollectedData> {
    if (!this.database.getRecentVaultDocuments) {
      return { recentlyModified: [] };
    }

    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const docs = await this.database.getRecentVaultDocuments(oneDayAgo, 20);
      return { recentlyModified: docs };
    } catch (err) {
      getLogger().warn({ err }, "Vault changes collection failed");
      return { recentlyModified: [] };
    }
  }

  async destroy(): Promise<void> {}

  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, lastCheck: new Date() };
  }
}
