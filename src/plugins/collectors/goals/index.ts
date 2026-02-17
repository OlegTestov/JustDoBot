import type {
  HealthStatus,
  ICollector,
  IMemoryProvider,
  PluginConfig,
} from "../../../core/interfaces";
import { getLogger } from "../../../core/logger";

export interface GoalsCollectedData {
  approaching: Array<{
    id: number;
    title: string;
    description?: string;
    deadline: string;
    status: string;
  }>;
}

export class GoalsCollector implements ICollector {
  name = "goals-collector";
  version = "1.0.0";
  type = "goals" as const;

  constructor(private database: IMemoryProvider) {}

  async init(_config: PluginConfig): Promise<void> {}

  async collect(): Promise<GoalsCollectedData> {
    if (!this.database.getActiveGoals) {
      return { approaching: [] };
    }
    try {
      const goals = await this.database.getActiveGoals();
      const now = Date.now();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

      const approaching = goals
        .filter((g) => g.deadline && new Date(g.deadline).getTime() - now <= threeDaysMs)
        .map((g) => ({
          id: g.id!,
          title: g.title,
          description: g.description?.slice(0, 150),
          deadline: g.deadline!,
          status: g.status,
        }));

      return { approaching };
    } catch (err) {
      getLogger().warn({ err }, "Goals collection failed");
      return { approaching: [] };
    }
  }

  async destroy(): Promise<void> {}

  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, lastCheck: new Date() };
  }
}
