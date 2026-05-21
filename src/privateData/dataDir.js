import { resolve } from "node:path";

export function resolvePrivateDataDir(env = process.env) {
  const configured = env.CAREERDEEPSEEK_DATA_DIR;
  if (!configured) {
    throw new Error("CAREERDEEPSEEK_DATA_DIR must be set before writing private records.");
  }

  return resolve(configured);
}
