import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const ProviderConfigSchema = z.object({
  estimatorAgentId: z.string().optional(),
  callerAgentId: z.string().optional(),
  closerAgentId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  updatedAt: z.string(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

const FILE = path.join(process.cwd(), "data", "provider-config.json");

export function readProviderConfig(): ProviderConfig {
  const env: ProviderConfig = {
    estimatorAgentId: process.env.ELEVENLABS_AGENT_ID_ESTIMATOR?.trim() || undefined,
    callerAgentId: process.env.ELEVENLABS_AGENT_ID_CALLER?.trim() || undefined,
    closerAgentId: process.env.ELEVENLABS_AGENT_ID_CLOSER?.trim() || undefined,
    phoneNumberId: process.env.ELEVENLABS_PHONE_NUMBER_ID?.trim() || undefined,
    updatedAt: new Date(0).toISOString(),
  };
  if (!fs.existsSync(FILE)) return env;
  try {
    const stored = ProviderConfigSchema.parse(JSON.parse(fs.readFileSync(FILE, "utf8")));
    return {
      ...stored,
      estimatorAgentId: env.estimatorAgentId ?? stored.estimatorAgentId,
      callerAgentId: env.callerAgentId ?? stored.callerAgentId,
      closerAgentId: env.closerAgentId ?? stored.closerAgentId,
      phoneNumberId: env.phoneNumberId ?? stored.phoneNumberId,
    };
  } catch {
    return env;
  }
}

export function writeProviderConfig(patch: Partial<ProviderConfig>): ProviderConfig {
  const next = ProviderConfigSchema.parse({
    ...readProviderConfig(),
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(temp, FILE);
  return next;
}
