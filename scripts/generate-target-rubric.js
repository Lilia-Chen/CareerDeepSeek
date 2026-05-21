#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRubricMarkdown } from "../src/scoring/markdownRubric.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const markdownPath = join(rootDir, "docs", "target-rubric.md");
const outputPath = join(rootDir, "config", "target-rubric.json");

const markdown = await readFile(markdownPath, "utf8");
const rubric = parseRubricMarkdown(markdown);

await writeFile(outputPath, `${JSON.stringify(rubric, null, 2)}\n`, "utf8");
console.log(`Generated ${outputPath} from ${markdownPath}`);
