import { readJson } from "../io/readJson.js";

export async function loadTargetRubric(path = new URL("../../config/target-rubric.json", import.meta.url)) {
  return readJson(path);
}
