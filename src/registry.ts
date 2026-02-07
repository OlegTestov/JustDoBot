import type { HealthStatus, IPlugin, PluginConfig } from "./core/interfaces";
import { getLogger } from "./core/logger";

export class PluginRegistry {
  private plugins = new Map<string, IPlugin>();
  private initOrder: string[] = [];

  register<T extends IPlugin>(type: string, plugin: T): void {
    this.plugins.set(type, plugin);
    this.initOrder.push(type);
  }

  get<T extends IPlugin>(type: string): T {
    const plugin = this.plugins.get(type);
    if (!plugin) {
      throw new Error(`Plugin "${type}" not registered`);
    }
    return plugin as T;
  }

  async initAll(config: PluginConfig): Promise<void> {
    const logger = getLogger();
    for (const type of this.initOrder) {
      const plugin = this.plugins.get(type)!;
      logger.info({ plugin: plugin.name }, `Initializing plugin: ${type}`);
      await plugin.init(config);
    }
  }

  async destroyAll(): Promise<void> {
    const logger = getLogger();
    for (const type of [...this.initOrder].reverse()) {
      const plugin = this.plugins.get(type)!;
      logger.info({ plugin: plugin.name }, `Destroying plugin: ${type}`);
      try {
        await plugin.destroy();
      } catch (err) {
        logger.error({ err, plugin: plugin.name }, "Error destroying plugin");
      }
    }
  }

  async healthCheckAll(): Promise<Map<string, HealthStatus>> {
    const results = new Map<string, HealthStatus>();
    for (const [type, plugin] of this.plugins) {
      try {
        results.set(type, await plugin.healthCheck());
      } catch (err) {
        results.set(type, {
          healthy: false,
          message: String(err),
          lastCheck: new Date(),
        });
      }
    }
    return results;
  }
}
